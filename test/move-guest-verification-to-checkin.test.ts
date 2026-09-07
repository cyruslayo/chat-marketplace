import assert from "node:assert/strict";
import test from "node:test";
import type { A2UIServerMessage } from "@weaver/core";
import { LocalGuestApp } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { createBookingRequestWebAgentAdapter } from "../apps/web-agent/src/index.js";
import { getConventionalBookingRequestView } from "../apps/web/src/presentation.js";
import { GuestVerificationService, type GuestIdentityVerificationResultSource } from "../domains/shortlet/src/index.js";
import { ContractAndArrivalReleaseManager } from "../domains/shortlet/src/contract-release.js";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";

type Surface = { readonly surfaceId: string; readonly a2uiMessages: readonly A2UIServerMessage[] };
type Result = Awaited<ReturnType<LocalGuestApp["handleEvent"]>>;

function action(surface: Surface) {
  const update = surface.a2uiMessages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
  assert.ok(update);
  const button = (update.updateComponents.components as readonly { readonly component: string; readonly action?: { readonly event?: { readonly name?: unknown; readonly context?: unknown } } }[]).find((component) => component.component === "Button" && component.action?.event);
  assert.ok(button?.action?.event);
  return { name: String(button.action.event.name), context: button.action.event.context as Record<string, unknown>, surfaceId: surface.surfaceId, sourceComponentId: "policy-test", timestamp: new Date().toISOString() };
}

function succeed(result: Result): Extract<Result, { readonly ok: true }> {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("journey stage failed");
  return result;
}

async function completeUnverifiedJourney() {
  const environment = new LocalGuestEnvironment({ databasePath: `.scratch/local-guest/policy-${Date.now()}-${crypto.randomUUID()}.sqlite` });
  const app = new LocalGuestApp(environment);
  const threadId = `g-${crypto.randomUUID()}`;
  const stages: Extract<Result, { readonly ok: true }>[] = [];
  let result = succeed(await app.handleTurn(threadId, "I need an apartment in Ikoyi for 3 nights for 2 people")); stages.push(result);
  result = succeed(app.handleEvent(threadId, action(result.surfaces[0]!))); stages.push(result);
  result = succeed(app.handleEvent(threadId, action(result.surfaces[0]!))); stages.push(result);
  result = succeed(app.handleEvent(threadId, action(result.surfaces[0]!))); stages.push(result);
  result = succeed(app.handleEvent(threadId, action(result.surfaces[0]!))); stages.push(result);
  const requestId = result.surfaces[0]!.surfaceId.split(":").at(-1)!;
  environment.simulateOperatorAcceptance(requestId);
  result = succeed(app.handleEvent(threadId, action(app.getState(threadId)!.surfaces[0]!))); stages.push(result);
  result = succeed(app.handleEvent(threadId, action(result.surfaces[0]!))); stages.push(result);
  result = succeed(app.handleEvent(threadId, action(result.surfaces[0]!))); stages.push(result);
  result = succeed(app.handleEvent(threadId, action(result.surfaces[0]!))); stages.push(result);
  result = succeed(app.handleEvent(threadId, action(result.surfaces[0]!))); stages.push(result);
  return { environment, app, threadId, requestId, stages, final: result };
}

function close(journey: { environment: LocalGuestEnvironment }): void { journey.environment.close(); }

test("AC1 — An unverified Guest can create a Request Draft", async () => { const j = await completeUnverifiedJourney(); try { assert.match(j.stages[2]!.surfaces[0]!.summary ?? "", /Request Draft/); } finally { close(j); } });
test("AC2 — An unverified Guest can open Request review", async () => { const j = await completeUnverifiedJourney(); try { assert.match(j.stages[3]!.surfaces[0]!.summary ?? "", /review/i); } finally { close(j); } });
test("AC3 — An unverified Guest can submit an otherwise valid Booking Request", async () => { const j = await completeUnverifiedJourney(); try { assert.match(j.stages[4]!.messages.join(" "), /Booking Request submitted/i); } finally { close(j); } });
test("AC4 — Guest Identity Verification is not checked during Booking Request disclosure", async () => { const j = await completeUnverifiedJourney(); try { assert.equal(j.environment.bookingRequestApp.manager.getRequest(j.requestId).primaryGuest.isGovernmentIdVerified, undefined); } finally { close(j); } });
test("AC5 — Operator confirmation does not require Guest Identity Verification", async () => { const j = await completeUnverifiedJourney(); try { assert.equal(j.environment.bookingRequestApp.manager.getRequest(j.requestId).status, "confirmed"); } finally { close(j); } });
test("AC6 — Conditional Booking Offer acceptance does not require Guest Identity Verification", async () => { const j = await completeUnverifiedJourney(); try { assert.match(j.stages[5]!.messages.join(" "), /Offer accepted/i); } finally { close(j); } });
test("AC7 — Payment initiation does not require Guest Identity Verification", async () => { const j = await completeUnverifiedJourney(); try { assert.match(j.stages[6]!.messages.join(" "), /checkout is ready/i); } finally { close(j); } });
test("AC8 — Payment verification does not require Guest Identity Verification", async () => { const j = await completeUnverifiedJourney(); try { assert.match(j.stages[7]!.messages.join(" "), /Payment verified/i); } finally { close(j); } });
test("AC9 — A valid Reservation can be created without Guest Identity Verification", async () => { const j = await completeUnverifiedJourney(); try { assert.match(j.final.messages.join(" "), /Reservation.*committed/i); } finally { close(j); } });

test("AC10 — Self-Booking requirements remain enforced", () => {
  const service = new GuestVerificationService();
  assert.throws(() => service.validateBookingEligibility({ tenantId: "t", unitId: "u", primaryGuest: { id: "g", name: "Guest" }, occupants: [{ name: "Guest" }], selfBookingAttestation: { accepted: false, version: "self-booking-v1" }, attestingPrincipalId: "g" }), /Self-Booking attestation/);
});
test("AC11 — Distinct payer requirements remain enforced", () => {
  const service = new GuestVerificationService();
  assert.throws(() => service.validateBookingEligibility({ tenantId: "t", unitId: "u", primaryGuest: { id: "g", name: "Guest" }, occupants: [{ name: "Guest" }], selfBookingAttestation: { accepted: true, version: "self-booking-v1" }, distinctPayer: { id: "p", name: "Payer" }, attestingPrincipalId: "g" }), /Distinct payer attestation/);
});
test("AC12 — All other Booking Request eligibility requirements remain enforced", () => {
  const service = new GuestVerificationService();
  assert.throws(() => service.validateBookingEligibility({ tenantId: "t", unitId: "u", primaryGuest: { id: "g", name: "Guest" }, occupants: [{ name: "Other" }], selfBookingAttestation: { accepted: true, version: "self-booking-v1" }, attestingPrincipalId: "g" }), /included in the overnight occupant roster/);
});
test("AC13 — The booking journey contains no obsolete verification-required blocking surface", async () => { const j = await completeUnverifiedJourney(); try { const text = JSON.stringify(j.stages); assert.doesNotMatch(text, /verification required|verify identity|VERIFICATION_REQUIRED/i); assert.equal(j.environment.telemetry.events().some((event) => event.type === "request_draft.blocked"), false); } finally { close(j); } });
test("AC14 — The conventional booking route follows the same identity-independent booking policy", async () => { const j = await completeUnverifiedJourney(); try { const artifact = getConventionalBookingRequestView(j.environment.bookingRequestApp, j.requestId, j.environment.guestPrincipal()).artifact; assert.equal(artifact.actions.length, 0); assert.doesNotMatch(JSON.stringify(artifact), /identity verification/i); } finally { close(j); } });
test("AC15 — Weaver booking presentation follows the same policy", async () => { const j = await completeUnverifiedJourney(); try { const operator = j.environment.representativePrincipal(); const view = createBookingRequestWebAgentAdapter({ application: j.environment.bookingRequestApp, principal: operator, createSurfaceId: (id) => `surface:${id}` }).get(j.requestId); assert.doesNotMatch(JSON.stringify(view.a2uiMessages), /identity verification|required before/i); } finally { close(j); } });
test("AC16 — Restart restoration does not reintroduce identity blocking", async () => { const j = await completeUnverifiedJourney(); const db = j.environment.config.databasePath; const thread = j.threadId; close(j); const restored = new LocalGuestEnvironment({ databasePath: db }); try { const state = new LocalGuestApp(restored).getState(thread); assert.ok(state); assert.doesNotMatch(JSON.stringify(state), /verification required|VERIFICATION_REQUIRED/i); } finally { restored.close(); } });
test("AC17 — Cross-tab behavior does not reintroduce identity blocking", async () => { const j = await completeUnverifiedJourney(); try { const second = new LocalGuestApp(j.environment); const state = second.getState(j.threadId); assert.ok(state); assert.doesNotMatch(JSON.stringify(state), /verification required|VERIFICATION_REQUIRED/i); } finally { close(j); } });
test("AC18 — Booking telemetry does not report missing identity verification as a booking failure", async () => { const j = await completeUnverifiedJourney(); try { const events = JSON.stringify(j.environment.telemetry.events()); assert.doesNotMatch(events, /VERIFICATION_REQUIRED|identity verification.*fail/i); assert.match(events, /booking_request\.submitted/); } finally { close(j); } });
test("AC19 — Guest identity verification domain capability remains available for future check-in use", () => { const source: GuestIdentityVerificationResultSource = { getVerificationResult: () => null }; const service = new GuestVerificationService({ verificationResults: source }); assert.throws(() => service.validateCheckInEligibility({ tenantId: "t", guestId: "g" }), /government-ID verification/); });

const contract = { contractId: "c", reservationId: "r", offerId: "o", unitId: "u", tenantId: "t", parties: { primaryGuest: { id: "g", name: "Guest" }, operator: { id: "o", name: "Operator" } }, dates: { checkIn: "2026-09-10", checkOut: "2026-09-12", nights: 2 }, occupants: [{ name: "Guest" }], quote: { totalAmountDueNowKobo: 100 }, totalAmountDueNowKobo: 100, policies: { cancellationPolicy: { type: "standard", version: "v1" }, guestConductRules: [] }, disclosures: [], paymentDetails: { pspReference: "p", paymentMethod: "fresh_card" as const, amountKobo: 100, currency: "NGN" as const, paidAt: "2026-09-01T00:00:00Z" }, createdAt: "2026-09-01T00:00:00Z", contractVersion: 1 };
const arrival = { contractId: "c", fullAddress: "protected address", accessInstructions: "door code", locationReferenceId: "loc", accessReferenceId: "access" };
function protectedManager(policy?: { canReleaseProtectedArrivalData?: () => boolean; canReleaseAccessInstructions: () => boolean }) { return new ContractAndArrivalReleaseManager({ repository: { findContractById: (id: string) => id === "c" ? contract : null, findArrivalDataByContractId: (id: string) => id === "c" ? arrival : null, findReservationById: (id: string) => id === "r" ? { reservationId: "r", status: "confirmed" } : null }, policy }); }
test("AC20 — A Reservation does not automatically imply physical-access eligibility", () => { const view = protectedManager().getBookingContractView(createPlatformCommandEnvelope({ commandName: "contract.get_view", principal: { id: "g", role: "guest", tenantId: "t" }, payload: { contractId: "c" } })); assert.equal(view.accessAvailability, "locked"); });
test("AC21 — Protected access information is not exposed before the future check-in eligibility boundary", () => { const manager = protectedManager(); const view = manager.getProtectedArrivalData(createPlatformCommandEnvelope({ commandName: "arrival_data.get_protected", principal: { id: "g", role: "guest", tenantId: "t" }, payload: { contractId: "c" } })); assert.equal(view.addressAvailability, "locked"); assert.equal(view.accessAvailability, "locked"); assert.equal(view.fullAddress, undefined); assert.equal(view.accessInstructions, undefined); });
test("AC22 — No external identity-provider dependency is introduced", () => { assert.equal(Object.keys(process.env).some((key) => /SMILE|PREMBLY|NIN|BVN/i.test(key)), false); assert.equal(typeof GuestVerificationService, "function"); });
test("AC23 — No raw identity evidence is added to booking storage", async () => { const j = await completeUnverifiedJourney(); try { assert.doesNotMatch(JSON.stringify(j.environment.bookingRequestApp.manager.getRequest(j.requestId)), /nin|bvn|passport|rawEvidence|biometric/i); } finally { close(j); } });
test("AC24 — Existing complete Guest journey still passes without a verified identity fixture", async () => { const j = await completeUnverifiedJourney(); try { assert.match(j.final.messages.join(" "), /Reservation.*committed/i); } finally { close(j); } });
