import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { operatorGet, startSignedInOperator, type SignedInOperator } from "./helpers/operator-session.js";

function requestFromGuest(operator: SignedInOperator, options: { phone?: string; email?: string } = {}) {
  const guest = LocalGuestEnvironment.openNode({ databasePath: operator.server.environment.config.databasePath, initialGuestPhoneNumber: null, initialGuestContactEmail: null });
  const principal = guest.guestPrincipal();
  guest.guestContactApp.submitPhone({ phoneNumber: options.phone ?? "0809 876 5432" }, principal);
  if (options.email) guest.guestContactApp.submitEmail({ contactEmail: options.email }, principal);
  const draft = guest.bookingRequestApp.createDraft({
    unitId: operator.server.environment.config.unitId,
    primaryGuest: { id: guest.config.guestId, name: guest.config.guestName },
    occupants: guest.demoOccupants(2),
    selfBookingAttestation: guest.selfBookingAttestation(),
    checkIn: "2026-09-10", checkOut: "2026-09-13",
  }, principal);
  const request = guest.bookingRequestApp.disclose(draft.draftId, principal);
  return { guest, requestId: request.requestId };
}

test("AC1: The back office shows the guest's stored phone and email for a Booking Request, not a constant", async () => {
  const operator = await startSignedInOperator();
  const { guest, requestId } = requestFromGuest(operator, { phone: "0809 876 5432", email: "guest@sample.test" });
  try {
    const response = await operatorGet(operator.session, `/operator/requests/${requestId}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /\+2348098765432/);
    assert.match(html, /guest@sample\.test/);
    assert.doesNotMatch(html, /\+2348012345678/);
    const anonymous = await operatorGet(operator.session, `/operator/requests/${requestId}`, "");
    assert.equal(anonymous.status, 303, "anonymous reads cannot see contact");
    assert.doesNotMatch(await anonymous.text(), /guest@sample\.test|2348098765432/);
    assert.doesNotMatch(JSON.stringify(operator.server.environment.listOperatorRequestArtifacts(operator.server.environment.getRepresentativePrincipal())), /guest@sample\.test|2348098765432/);
    assert.equal(operator.server.environment.interactionStore.findBookingRequestContactEmail(requestId, "another-tenant"), null);
    assert.throws(() => operator.server.environment.operatorRequestDetail(requestId, { ...operator.server.environment.getRepresentativePrincipal(), tenantId: "another-tenant" }), /not found/);
  } finally { guest.close(); await operator.close(); }
});

test("AC2 failure path: a request with no stored contact shows that the contact is missing; it never shows a placeholder number", async () => {
  const operator = await startSignedInOperator();
  const { guest, requestId } = requestFromGuest(operator);
  try {
    guest.database.prepare("UPDATE guest_booking_requests SET phone_number = NULL WHERE request_id = $id").run({ $id: requestId });
    const html = await (await operatorGet(operator.session, `/operator/requests/${requestId}`)).text();
    assert.match(html, /Phone number<\/dt><dd>Not on file/);
    assert.match(html, /Email<\/dt><dd>Not on file/);
    assert.doesNotMatch(html, /\+2348012345678|\+2348098765432/);
  } finally { guest.close(); await operator.close(); }
});

test("AC3: Guest verification at request time follows ADR 0085 and is never a hard-coded true", async () => {
  const operator = await startSignedInOperator();
  const { guest, requestId } = requestFromGuest(operator);
  try {
    const request = operator.server.environment.bookingRequestApp.getRequest(requestId);
    assert.equal(request.status, "disclosed", "an unverified guest can submit a Booking Request");
    const detail = operator.server.environment.operatorRequestDetail(requestId, operator.server.environment.getRepresentativePrincipal());
    assert.equal(JSON.stringify(detail).includes("governmentIdVerified"), false, "no unverified guest may acquire a false ID-verification claim");
  } finally { guest.close(); await operator.close(); }
});

test("AC4: Operator reliability comes from stored bookings or the cold-start policy cited by ADR", async () => {
  const operator = await startSignedInOperator();
  try {
    const env = operator.server.environment;
    const result = env.reliabilityAuthority.getReliability({ operatorId: env.config.operatorId, tenantId: env.config.tenantId });
    assert.equal(result.trailing60dOpportunities, 0);
    assert.equal(result.trailing180dOpportunities, 0);
    assert.equal(result.trailing60dCompletedBookings, 0);
    assert.equal(result.trailing180dCompletedBookings, 0);
    assert.equal(result.trailing60dReliabilityRate, null, "no observed rate before ten opportunities");
    assert.equal(result.trailing180dReliabilityRate, null);
    assert.throws(() => env.reliabilityAuthority.getReliability({ operatorId: "other-owner", tenantId: env.config.tenantId }), /scope mismatch/);
    assert.equal(env.getStateOverview().trustTier.tier, "standard");
    assert.doesNotMatch(await (await operatorGet(operator.session, "/operator")).text(), /98% reliability|99% reliability/);
  } finally { await operator.close(); }
});

test("AC5: A grep test fails if +2348012345678 or governmentIdVerified: true appears in non-test production composition", () => {
  const source = readFileSync("apps/local-owner/src/local-owner-environment.ts", "utf8");
  assert.doesNotMatch(source, /\+2348012345678|governmentIdVerified:\s*true/);
  assert.doesNotMatch(source, /trailing60dCompletedBookings:\s*12|trailing180dCompletedBookings:\s*35|trailing60dReliabilityRate:\s*0\.98/);
});
