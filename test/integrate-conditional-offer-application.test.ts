import assert from "node:assert/strict";
import test from "node:test";
import type { WebServerEventHandoff } from "@weaver/web";
import { InMemoryAuditLog } from "../packages/platform-core/src/index.js";
import { AvailabilityCalendar, BookingRequestManager, ConditionalOfferManager, GuestVerificationService, UnitRepository, seedIssue01Units } from "../domains/shortlet/src/index.js";
import { createBookingRequestApplication } from "../apps/web/src/booking-request-application.js";
import { createConditionalOfferApplication } from "../apps/web/src/conditional-offer-application.js";
import { acceptConventionalConditionalOffer } from "../apps/web/src/presentation.js";
import { resolveConditionalOfferServerEvent } from "../apps/web/src/conditional-offer-actions.js";

function setup() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const audit = new InMemoryAuditLog();
  const calendar = new AvailabilityCalendar({ repository, audit });
  const operatorAuthority = {
    canActForOperator: ({ actorId, operatorId, tenantId }: { actorId: string; operatorId: string; tenantId: string }) =>
      tenantId === "tenant-lagos" && actorId === "rep-operator" && operatorId === "operator-001",
  };
  const guestVerification = new GuestVerificationService({ repository, verificationResults: { getVerificationResult: ({ tenantId, guestId }) => tenantId === "tenant-lagos" && guestId.startsWith("guest-") ? { tenantId, guestId, governmentIdVerified: true } : null } });
  const clock = () => new Date("2026-07-22T10:00:00Z");
  const bookingRequestApplication = createBookingRequestApplication({ repository, audit, calendar, guestVerification, operatorAuthority, clock });
  const application = createConditionalOfferApplication({ bookingRequestApplication, repository, audit, calendar, clock, operatorAuthority });
  return { repository, audit, calendar, bookingRequestApplication, application, unit: repository.findAll()[0], clock };
}

function confirmedRequest(s: ReturnType<typeof setup>, guestId: string, checkIn: string, checkOut: string) {
  const principal = { id: guestId, role: "guest" as const, tenantId: "tenant-lagos" };
  const draft = s.bookingRequestApplication.createDraft({ unitId: s.unit.id, primaryGuest: { id: guestId, name: "Guest Name" }, occupants: [{ name: "Guest Name" }], selfBookingAttestation: { accepted: true, version: "self-booking-v1" }, checkIn, checkOut }, principal);
  const request = s.bookingRequestApplication.disclose(draft.draftId, principal);
  return s.bookingRequestApplication.confirm({ artifactId: `booking-request:${request.requestId}`, requestId: request.requestId, expectedStatus: "disclosed", projectionVersion: 3, principal: { id: "rep-operator", role: "operator", tenantId: "tenant-lagos" }, action: "confirm" });
}

function event(context: unknown): WebServerEventHandoff {
  return { message: { action: { name: "shortlet.conditional-offer.accept", context } } } as unknown as WebServerEventHandoff;
}

test("Conditional Offer application shares Booking Request state and creates trusted issue and accept envelopes", () => {
  const s = setup();
  const request = confirmedRequest(s, "guest-101", "2026-08-01", "2026-08-05");
  const operator = { id: "rep-operator", role: "operator" as const, tenantId: "tenant-lagos" };
  const offer = s.application.issue(request.requestId, operator);
  assert.equal(s.application.manager instanceof ConditionalOfferManager, true);
  assert.equal(s.application.manager.constructor.name, "ConditionalOfferManager");
  assert.equal(s.bookingRequestApplication.manager.constructor.name, "BookingRequestManager");
  assert.equal(offer.status, "issued");
  const artifact = s.application.getArtifact(offer.offerId, { id: "guest-101", role: "guest", tenantId: "tenant-lagos" });
  assert.equal(artifact.kind, "shortlet.conditional-booking-offer");
  assert.equal(artifact.schemaVersion, "shortlet.conditional-booking-offer/v1");
  assert.equal(artifact.id, `conditional-offer:${offer.offerId}`);
  assert.equal(artifact.actions.length, 1);
  assert.equal(JSON.stringify(artifact.facts).includes("confirmationToken"), false);
  assert.equal(JSON.stringify(artifact).includes("passport"), false);
  assert.throws(() => s.application.issue(request.requestId, { id: operator.id, role: "operator", tenantId: "tenant-abuja" }), /Cross-tenant|authorized/i);

  const result = resolveConditionalOfferServerEvent({
    event: event({ artifactId: artifact.actions[0].artifactId, offerId: artifact.actions[0].offerId, expectedStatus: artifact.actions[0].expectedStatus, offerVersion: artifact.actions[0].offerVersion, projectionVersion: artifact.actions[0].projectionVersion, confirmationToken: artifact.actions[0].confirmationToken }),
    application: s.application,
    principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.artifact.facts.status, "accepted");
  const request2 = confirmedRequest(s, "guest-102", "2026-08-06", "2026-08-09");
  const offer2 = s.application.issue(request2.requestId, operator);
  const guest2 = { id: "guest-102", role: "guest" as const, tenantId: "tenant-lagos" };
  const artifact2 = s.application.getArtifact(offer2.offerId, guest2);
  const conventionalResult = acceptConventionalConditionalOffer(s.application, { offerId: offer2.offerId, confirmationToken: artifact2.actions[0].confirmationToken, expectedVersion: artifact2.actions[0].offerVersion, principal: guest2 });
  assert.equal(conventionalResult.facts.status, "accepted");
  assert.equal(s.audit.entries().filter((entry) => entry.type === "conditional_offer.accepted").length, 2);
});

test("Conditional Offer server events reject stale, replayed, expired, and unauthorized actions", () => {
  const s = setup();
  const request = confirmedRequest(s, "guest-101", "2026-08-06", "2026-08-09");
  const offer = s.application.issue(request.requestId, { id: "rep-operator", role: "operator", tenantId: "tenant-lagos" });
  const principal = { id: "guest-101", role: "guest" as const, tenantId: "tenant-lagos" };
  const artifact = s.application.getArtifact(offer.offerId, principal);
  const action = artifact.actions[0];
  const actionContext = { artifactId: action.artifactId, offerId: action.offerId, expectedStatus: action.expectedStatus, offerVersion: action.offerVersion, projectionVersion: action.projectionVersion, confirmationToken: action.confirmationToken };
  assert.equal(resolveConditionalOfferServerEvent({ event: event({ ...actionContext, projectionVersion: action.projectionVersion + 1 }), application: s.application, principal }).ok, false);
  assert.equal(resolveConditionalOfferServerEvent({ event: event(actionContext), application: s.application, principal }).ok, true);
  assert.equal(resolveConditionalOfferServerEvent({ event: event(actionContext), application: s.application, principal }).ok, false);

  const request2 = confirmedRequest(s, "guest-102", "2026-08-10", "2026-08-12");
  const offer2 = s.application.issue(request2.requestId, { id: "rep-operator", role: "operator", tenantId: "tenant-lagos" });
  const action2 = s.application.getArtifact(offer2.offerId, { id: "guest-102", role: "guest", tenantId: "tenant-lagos" }).actions[0];
  assert.equal(resolveConditionalOfferServerEvent({ event: event({ artifactId: action2.artifactId, offerId: action2.offerId, expectedStatus: action2.expectedStatus, offerVersion: action2.offerVersion, projectionVersion: action2.projectionVersion, confirmationToken: action2.confirmationToken }), application: s.application, principal: { id: "guest-102", role: "guest", tenantId: "tenant-abuja" } }).ok, false);
});
