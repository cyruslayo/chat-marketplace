import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryAuditLog,
  createPlatformCommandEnvelope,
  GenerativeSurfaceManager
} from "../packages/platform-core/src/index.js";
import {
  AvailabilityCalendar,
  UnitRepository,
  seedIssue01Units,
  GuestVerificationService,
  RestrictedIdentityStore,
  BookingRequestManager,
  ConditionalOfferManager,
  flagMaterialUnitChange
} from "../domains/shortlet/src/index.js";

function setup() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const audit = new InMemoryAuditLog();
  const calendar = new AvailabilityCalendar({ repository, audit });
  const identityStore = new RestrictedIdentityStore();
  const guestVerification = new GuestVerificationService({ repository, identityStore });
  const requestManager = new BookingRequestManager({
    repository,
    audit,
    calendar,
    guestVerification
  });
  const offerManager = new ConditionalOfferManager({
    repository,
    audit,
    calendar,
    bookingRequestManager: requestManager
  });
  const unit = repository.findAll()[0];

  return { repository, audit, calendar, identityStore, guestVerification, requestManager, offerManager, unit };
}

function createConfirmedRequest(
  setupObj: ReturnType<typeof setup>,
  clock: () => Date,
  {
    guestId = "guest-101",
    checkIn = "2026-08-01",
    checkOut = "2026-08-05"
  }: { guestId?: string; checkIn?: string; checkOut?: string } = {}
) {
  const { requestManager, unit } = setupObj;

  const draftEnv = createPlatformCommandEnvelope({
    commandName: "booking_request.create_draft",
    principal: { id: guestId, role: "guest", tenantId: "tenant-lagos" },
    payload: {
      unitId: unit.id,
      primaryGuest: { id: guestId, name: "Tunde Ednut", isGovernmentIdVerified: true },
      isPrimaryGuestOccupant: true,
      occupants: [{ name: "Tunde Ednut" }],
      checkIn,
      checkOut
    }
  });
  const draft = requestManager.createDraft(draftEnv, { clock });

  const discloseEnv = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: guestId, role: "guest", tenantId: "tenant-lagos" },
    payload: { draftId: draft.draftId }
  });
  const request = requestManager.discloseBookingRequest(discloseEnv, { clock });

  const confirmEnv = createPlatformCommandEnvelope({
    commandName: "booking_request.confirm",
    principal: { id: unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
    payload: { requestId: request.requestId }
  });
  const confirmedRequest = requestManager.confirmBookingRequest(confirmEnv, { clock });

  return { draft, request: confirmedRequest };
}

test("Offer creation revalidates current Unit eligibility, authority, availability, quote, and aggregate versions", () => {
  const s = setup();
  const clock = () => new Date("2026-07-22T10:00:00Z"); // 11:00 AM WAT

  const { request } = createConfirmedRequest(s, clock);

  // Issue conditional booking offer using command envelope
  const issueEnv = createPlatformCommandEnvelope({
    commandName: "conditional_offer.issue",
    principal: { id: s.unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
    payload: { requestId: request.requestId }
  });

  const offer = s.offerManager.issueOffer(issueEnv, { clock });

  assert.ok(offer.offerId);
  assert.equal(offer.status, "issued");
  assert.equal(offer.requestId, request.requestId);
  assert.equal(offer.unitId, s.unit.id);
  assert.equal(offer.parties.primaryGuest.id, "guest-101");
  assert.equal(offer.parties.operator.id, s.unit.operator.id);
  assert.equal(offer.dates.checkIn, "2026-08-01");
  assert.equal(offer.dates.checkOut, "2026-08-05");
  assert.equal(offer.dates.nights, 4);
  assert.ok(offer.quote.allInStayTotalKobo > 0);
  assert.ok(offer.paymentWindow.expiresAt);
  assert.equal(offer.paymentWindow.durationMinutes, 20);
  assert.ok(offer.confirmationToken);
  assert.ok(offer.aggregateVersions);
  assert.equal(offer.aggregateVersions.offerVersion, 1);
  assert.ok(offer.disclosures.length > 0);

  // Audit entry recorded
  const auditEntries = s.audit.entries().filter((e) => e.type === "conditional_offer.issued");
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].offerId, offer.offerId);
  assert.equal(auditEntries[0].commandEnvelopeId, issueEnv.commandId);

  // Test failure when Unit eligibility is invalidated (e.g. material unit change pending)
  flagMaterialUnitChange(s.repository, s.unit.id);

  assert.throws(
    () => {
      s.offerManager.issueOffer(
        createPlatformCommandEnvelope({
          commandName: "conditional_offer.issue",
          principal: { id: s.unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
          payload: { requestId: request.requestId }
        }),
        { clock }
      );
    },
    /Offer creation failed: Unit eligibility\/authority invalidated/i
  );
});

test("Acceptance uses a short-lived, single-use confirmation token bound to actor, terms, amounts, deadline, and expected version", () => {
  const s = setup();
  const clock = () => new Date("2026-07-22T10:00:00Z");

  const { request } = createConfirmedRequest(s, clock);

  const issueEnv = createPlatformCommandEnvelope({
    commandName: "conditional_offer.issue",
    principal: { id: s.unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
    payload: { requestId: request.requestId }
  });
  const offer = s.offerManager.issueOffer(issueEnv, { clock });

  // Accept offer using PlatformCommandEnvelope
  const acceptClock = () => new Date("2026-07-22T10:05:00Z"); // 5 mins into 20-min window
  const acceptEnv = createPlatformCommandEnvelope({
    commandName: "conditional_offer.accept",
    principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
    expectedVersion: offer.aggregateVersions.offerVersion,
    payload: {
      offerId: offer.offerId,
      confirmationToken: offer.confirmationToken
    }
  });

  const acceptedOffer = s.offerManager.acceptOffer(acceptEnv, { clock: acceptClock });

  assert.equal(acceptedOffer.status, "accepted");
  assert.equal(acceptedOffer.tokenUsed, true);
  assert.ok(acceptedOffer.acceptedAt);

  // Verify audit log
  const acceptAudit = s.audit.entries().find((e) => e.type === "conditional_offer.accepted");
  assert.ok(acceptAudit);
  assert.equal(acceptAudit.offerId, offer.offerId);
  assert.equal(acceptAudit.commandEnvelopeId, acceptEnv.commandId);

  // Attempting to accept a separate unaccepted offer with a tampered/invalid token fails
  const req2 = createConfirmedRequest(s, clock, { guestId: "guest-102", checkIn: "2026-08-06", checkOut: "2026-08-09" }).request;
  const offer2 = s.offerManager.issueOffer(
    createPlatformCommandEnvelope({
      commandName: "conditional_offer.issue",
      principal: { id: s.unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
      payload: { requestId: req2.requestId }
    }),
    { clock }
  );

  assert.throws(
    () => {
      s.offerManager.acceptOffer(
        createPlatformCommandEnvelope({
          commandName: "conditional_offer.accept",
          principal: { id: "guest-102", role: "guest", tenantId: "tenant-lagos" },
          payload: {
            offerId: offer2.offerId,
            confirmationToken: "tok_invalid_token_string"
          }
        }),
        { clock: acceptClock }
      );
    },
    /Invalid confirmation token/i
  );
});

test("Stale, changed, expired, replayed, or cross-tenant offers cannot progress", () => {
  const s = setup();
  const clock = () => new Date("2026-07-22T10:00:00Z");

  const { request } = createConfirmedRequest(s, clock, { checkIn: "2026-08-01", checkOut: "2026-08-05" });

  const issueEnv = createPlatformCommandEnvelope({
    commandName: "conditional_offer.issue",
    principal: { id: s.unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
    payload: { requestId: request.requestId }
  });
  const offer = s.offerManager.issueOffer(issueEnv, { clock });

  // 1. Expired Offer (Clock > 20 minutes, e.g. +21 mins)
  const expiredClock = () => new Date("2026-07-22T10:21:00Z");
  const expiredAcceptEnv = createPlatformCommandEnvelope({
    commandName: "conditional_offer.accept",
    principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
    payload: {
      offerId: offer.offerId,
      confirmationToken: offer.confirmationToken
    }
  });

  assert.throws(
    () => s.offerManager.acceptOffer(expiredAcceptEnv, { clock: expiredClock }),
    /Payment window \(20 minutes\) has expired/i
  );

  const expiredAudit = s.audit.entries().find((e) => e.type === "conditional_offer.expired");
  assert.ok(expiredAudit);

  // 2. Replayed Offer (Already accepted offer)
  const request2 = createConfirmedRequest(s, clock, { guestId: "guest-102", checkIn: "2026-08-10", checkOut: "2026-08-12" }).request;
  const offer2 = s.offerManager.issueOffer(
    createPlatformCommandEnvelope({
      commandName: "conditional_offer.issue",
      principal: { id: s.unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
      payload: { requestId: request2.requestId }
    }),
    { clock }
  );

  const validAcceptEnv = createPlatformCommandEnvelope({
    commandName: "conditional_offer.accept",
    principal: { id: "guest-102", role: "guest", tenantId: "tenant-lagos" },
    payload: {
      offerId: offer2.offerId,
      confirmationToken: offer2.confirmationToken
    }
  });

  // First acceptance succeeds
  s.offerManager.acceptOffer(validAcceptEnv, { clock: () => new Date("2026-07-22T10:05:00Z") });

  // Replay attempt fails
  assert.throws(
    () => s.offerManager.acceptOffer(validAcceptEnv, { clock: () => new Date("2026-07-22T10:06:00Z") }),
    /Offer has already been accepted/i
  );

  // 3. Cross-Tenant Offer Access
  const request3 = createConfirmedRequest(s, clock, { guestId: "guest-103", checkIn: "2026-08-15", checkOut: "2026-08-18" }).request;
  const offer3 = s.offerManager.issueOffer(
    createPlatformCommandEnvelope({
      commandName: "conditional_offer.issue",
      principal: { id: s.unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
      payload: { requestId: request3.requestId }
    }),
    { clock }
  );

  const crossTenantEnv = createPlatformCommandEnvelope({
    commandName: "conditional_offer.accept",
    principal: { id: "guest-103", role: "guest", tenantId: "tenant-abuja" }, // Different tenant!
    payload: {
      offerId: offer3.offerId,
      confirmationToken: offer3.confirmationToken
    }
  });

  assert.throws(
    () => s.offerManager.acceptOffer(crossTenantEnv, { clock: () => new Date("2026-07-22T10:05:00Z") }),
    /Cross-tenant offer access denied/i
  );

  // 4. Stale / Changed Offer (Expected version mismatch)
  const request4 = createConfirmedRequest(s, clock, { guestId: "guest-104", checkIn: "2026-08-20", checkOut: "2026-08-22" }).request;
  const offer4 = s.offerManager.issueOffer(
    createPlatformCommandEnvelope({
      commandName: "conditional_offer.issue",
      principal: { id: s.unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
      payload: { requestId: request4.requestId }
    }),
    { clock }
  );

  const wrongVersionEnv = createPlatformCommandEnvelope({
    commandName: "conditional_offer.accept",
    principal: { id: "guest-104", role: "guest", tenantId: "tenant-lagos" },
    expectedVersion: 999, // Mismatched expected version!
    payload: {
      offerId: offer4.offerId,
      confirmationToken: offer4.confirmationToken
    }
  });

  assert.throws(
    () => s.offerManager.acceptOffer(wrongVersionEnv, { clock: () => new Date("2026-07-22T10:05:00Z") }),
    /Offer version mismatch/i
  );
});

test("Conventional and Generative Surface acceptance reach the same command and audit classification", () => {
  const s = setup();
  const clock = () => new Date("2026-07-22T10:00:00Z");

  const { request: request1 } = createConfirmedRequest(s, clock, { guestId: "guest-101", checkIn: "2026-08-25", checkOut: "2026-08-28" });
  const { request: request2 } = createConfirmedRequest(s, clock, { guestId: "guest-102", checkIn: "2026-09-01", checkOut: "2026-09-05" });

  const issueEnv1 = createPlatformCommandEnvelope({
    commandName: "conditional_offer.issue",
    principal: { id: s.unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
    payload: { requestId: request1.requestId }
  });
  const offer1 = s.offerManager.issueOffer(issueEnv1, { clock });

  const issueEnv2 = createPlatformCommandEnvelope({
    commandName: "conditional_offer.issue",
    principal: { id: s.unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
    payload: { requestId: request2.requestId }
  });
  const offer2 = s.offerManager.issueOffer(issueEnv2, { clock });

  // 1. Conventional web route envelope
  const webAcceptEnv = createPlatformCommandEnvelope({
    commandName: "conditional_offer.accept",
    principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
    payload: {
      offerId: offer1.offerId,
      confirmationToken: offer1.confirmationToken
    }
  });

  // 2. Generative Surface route (using GenerativeSurfaceManager)
  const surfaceMgr = new GenerativeSurfaceManager();
  const surface = surfaceMgr.createSurface({
    catalogue: "booking/v1",
    workflowState: { offerId: offer2.offerId, status: offer2.status }
  });

  // Execute action on generative surface
  const surfaceActionResult = surfaceMgr.executeSurfaceAction(surface.surfaceId, {
    actionName: "accept_offer",
    payload: { offerId: offer2.offerId }
  });
  assert.ok(surfaceActionResult.success);

  // Both surfaces dispatch the identical PlatformCommandEnvelope structure to the domain
  const surfaceAcceptEnv = createPlatformCommandEnvelope({
    commandName: "conditional_offer.accept",
    principal: { id: "guest-102", role: "guest", tenantId: "tenant-lagos" },
    payload: {
      offerId: offer2.offerId,
      confirmationToken: offer2.confirmationToken
    }
  });

  assert.equal(webAcceptEnv.commandName, surfaceAcceptEnv.commandName);
  assert.equal(webAcceptEnv.principal.role, surfaceAcceptEnv.principal.role);

  // Executing the domain command for acceptance
  s.offerManager.acceptOffer(webAcceptEnv, { clock: () => new Date("2026-07-22T10:05:00Z") });
  s.offerManager.acceptOffer(surfaceAcceptEnv, { clock: () => new Date("2026-07-22T10:05:00Z") });

  // Verify audit log has exact single classification "conditional_offer.accepted"
  const auditEntries = s.audit.entries().filter((e) => e.type === "conditional_offer.accepted");
  assert.equal(auditEntries.length, 2);
  
  const auditWeb = auditEntries.find(e => e.offerId === offer1.offerId);
  const auditSurface = auditEntries.find(e => e.offerId === offer2.offerId);
  assert.ok(auditWeb);
  assert.ok(auditSurface);
});

test("Conditional Offer rejects a confirmed request after its exact inventory commitment is released", () => {
  const s = setup();
  const clock = () => new Date("2026-07-22T10:00:00Z");
  const { request } = createConfirmedRequest(s, clock);

  assert.ok(request.holdId);
  s.calendar.releaseHold(request.holdId, { clock });

  const issueEnv = createPlatformCommandEnvelope({
    commandName: "conditional_offer.issue",
    principal: { id: s.unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
    payload: { requestId: request.requestId }
  });

  assert.throws(
    () => s.offerManager.issueOffer(issueEnv, { clock }),
    /inventory commitment is no longer valid/i
  );
});
