import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryAuditLog,
  createPlatformCommandEnvelope
} from "../packages/platform-core/src/index.js";
import {
  AvailabilityCalendar,
  UnitRepository,
  seedIssue01Units,
  GuestVerificationService,
  GuestIdentityVerificationResultSource,
  RestrictedIdentityStore,
  BookingRequestManager
} from "../domains/shortlet/src/index.js";

function setup() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const audit = new InMemoryAuditLog();
  const calendar = new AvailabilityCalendar({ repository, audit });
  const identityStore = new RestrictedIdentityStore();
  const verificationResults: GuestIdentityVerificationResultSource = {
    getVerificationResult: ({ tenantId, guestId }) => ({ tenantId, guestId, governmentIdVerified: true })
  };
  const guestVerification = new GuestVerificationService({ repository, verificationResults });
  const manager = new BookingRequestManager({
    repository,
    audit,
    calendar,
    guestVerification
  });
  const unit = repository.findAll()[0];
  return { repository, audit, calendar, identityStore, guestVerification, manager, unit };
}

test("Drafts do not block inventory; successfully disclosed requests do so exclusively for the 30-minute window", () => {
  const { manager, calendar, unit, audit } = setup();
  const clock = () => new Date("2026-07-22T10:00:00Z"); // 11:00 AM WAT

  // Create a draft using PlatformCommandEnvelope (ADR 0072)
  const draftEnvelope = createPlatformCommandEnvelope({
    commandName: "booking_request.create_draft",
    principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
    payload: {
      unitId: unit.id,
      primaryGuest: { id: "guest-101", name: "Tunde Ednut", isGovernmentIdVerified: true },
      selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
      occupants: [{ name: "Tunde Ednut" }],
      checkIn: "2026-08-01",
      checkOut: "2026-08-05"
    }
  });

  const draft = manager.createDraft(draftEnvelope, { clock });

  assert.ok(draft.draftId);
  assert.equal(draft.status, "draft");

  // Verify draft audit entry contains commandEnvelopeId
  const draftAudit = audit.entries().find((e) => e.type === "booking_request.draft_created");
  assert.ok(draftAudit);
  assert.equal(draftAudit.commandEnvelopeId, draftEnvelope.commandId);

  // Verify draft does NOT block inventory
  const initialAvailability = calendar.getAuthoritativeAvailability({
    unitId: unit.id,
    checkIn: "2026-08-01",
    checkOut: "2026-08-05",
    clock
  });
  assert.equal(initialAvailability.isAvailable, true);

  // Wrap disclose in PlatformCommandEnvelope
  const discloseEnvelope = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
    payload: { draftId: draft.draftId }
  });

  const request = manager.discloseBookingRequest(discloseEnvelope, { clock });
  assert.ok(request.requestId);
  assert.equal(request.status, "disclosed");
  assert.equal(request.distinctPayer, null);
  assert.ok(request.holdId);

  // Now inventory IS exclusively blocked for 30 minutes
  const postDiscloseAvailability = calendar.getAuthoritativeAvailability({
    unitId: unit.id,
    checkIn: "2026-08-01",
    checkOut: "2026-08-05",
    clock
  });
  assert.equal(postDiscloseAvailability.isAvailable, false);
  assert.equal(postDiscloseAvailability.conflictReason, "Overlaps with Booking Request Block");
});

test("Disclosure fails closed without authoritative verification and rejects cross-principal disclosure before inventory or audit", () => {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const audit = new InMemoryAuditLog();
  const calendar = new AvailabilityCalendar({ repository, audit });
  const manager = new BookingRequestManager({ repository, audit, calendar });
  const unit = repository.findAll()[0];
  const clock = () => new Date("2026-07-22T10:00:00Z");
  const draft = manager.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "guest-B", name: "Guest B", isGovernmentIdVerified: true },
    occupants: [{ name: "Guest B" }],
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    checkIn: "2026-08-01",
    checkOut: "2026-08-03"
  });
  const before = audit.entries().length;
  assert.throws(() => manager.discloseBookingRequest(createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-A", role: "guest", tenantId: "tenant-lagos" },
    payload: { draftId: draft.draftId }
  }), { clock }), /Primary Guest/i);
  assert.equal(calendar.getAuthoritativeAvailability({ unitId: unit.id, checkIn: draft.checkIn, checkOut: draft.checkOut, clock }).isAvailable, true);
  assert.equal(manager.getDraft(draft.draftId).status, "draft");
  assert.equal(audit.entries().length, before);
});

test("Disclosure enforces one-to-fourteen nights, 90-day horizon, active hours window, and safe cutoff", () => {
  const { manager, unit } = setup();

  // 1. Enforce stay length: 0 nights
  assert.throws(
    () => {
      const draft = manager.createDraft({
        unitId: unit.id,
        primaryGuest: { id: "guest-101", name: "Tunde Ednut", isGovernmentIdVerified: true },
        selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
        occupants: [{ name: "Tunde Ednut" }],
        checkIn: "2026-08-01",
        checkOut: "2026-08-01",
        clock: () => new Date("2026-07-22T10:00:00Z")
      });
      const env = createPlatformCommandEnvelope({
        commandName: "booking_request.disclose",
        principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
        payload: { draftId: draft.draftId }
      });
      manager.discloseBookingRequest(env, { clock: () => new Date("2026-07-22T10:00:00Z") });
    },
    /Stay length must be between 1 and 14 nights/i
  );

  // 2. Enforce stay length: 15 nights
  assert.throws(
    () => {
      const draft = manager.createDraft({
        unitId: unit.id,
        primaryGuest: { id: "guest-101", name: "Tunde Ednut", isGovernmentIdVerified: true },
        selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
        occupants: [{ name: "Tunde Ednut" }],
        checkIn: "2026-08-01",
        checkOut: "2026-08-16",
        clock: () => new Date("2026-07-22T10:00:00Z")
      });
      const env = createPlatformCommandEnvelope({
        commandName: "booking_request.disclose",
        principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
        payload: { draftId: draft.draftId }
      });
      manager.discloseBookingRequest(env, { clock: () => new Date("2026-07-22T10:00:00Z") });
    },
    /Stay length must be between 1 and 14 nights/i
  );

  // 3. Enforce 90-day booking horizon (>90 days from today)
  assert.throws(
    () => {
      const draft = manager.createDraft({
        unitId: unit.id,
        primaryGuest: { id: "guest-101", name: "Tunde Ednut", isGovernmentIdVerified: true },
        selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
        occupants: [{ name: "Tunde Ednut" }],
        checkIn: "2026-11-01", // > 90 days from July 22
        checkOut: "2026-11-05",
        clock: () => new Date("2026-07-22T10:00:00Z")
      });
      const env = createPlatformCommandEnvelope({
        commandName: "booking_request.disclose",
        principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
        payload: { draftId: draft.draftId }
      });
      manager.discloseBookingRequest(env, { clock: () => new Date("2026-07-22T10:00:00Z") });
    },
    /booking horizon/i
  );

  // 4. Enforce Operator Active Hours response window (ADR 0041 & ADR 0042: full 30-min window must fit inside 08:00 - 20:00 WAT -> latest disclosure 19:30 WAT)
  // Test disclosure at 19:35 WAT (18:35 UTC) -> fails because 30-min window ends at 20:05 WAT
  assert.throws(
    () => {
      const draft = manager.createDraft({
        unitId: unit.id,
        primaryGuest: { id: "guest-101", name: "Tunde Ednut", isGovernmentIdVerified: true },
        selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
        occupants: [{ name: "Tunde Ednut" }],
        checkIn: "2026-08-01",
        checkOut: "2026-08-03",
        clock: () => new Date("2026-07-22T18:35:00Z") // 19:35 WAT
      });
      const env = createPlatformCommandEnvelope({
        commandName: "booking_request.disclose",
        principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
        payload: { draftId: draft.draftId }
      });
      manager.discloseBookingRequest(env, { clock: () => new Date("2026-07-22T18:35:00Z") });
    },
    /Operator Active Hours/i
  );

  // Disclosure at 19:25 WAT (18:25 UTC) -> full 30-min window ends at 19:55 WAT <= 20:00 WAT -> succeeds!
  const validEveningDraft = manager.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "guest-101", name: "Tunde Ednut", isGovernmentIdVerified: true },
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    occupants: [{ name: "Tunde Ednut" }],
    checkIn: "2026-08-01",
    checkOut: "2026-08-03",
    clock: () => new Date("2026-07-22T18:25:00Z") // 19:25 WAT
  });
  const validEveningEnv = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
    payload: { draftId: validEveningDraft.draftId }
  });
  const disclosedEvening = manager.discloseBookingRequest(validEveningEnv, { clock: () => new Date("2026-07-22T18:25:00Z") });
  assert.equal(disclosedEvening.status, "disclosed");

  // 5. Enforce Latest Disclosure Cutoff (ADR 0053: Cutoff 11:00 AM WAT; 5-min delivery window requires disclosure by 10:55 AM WAT)
  // Same-day check-in on 2026-07-22 disclosed at 10:56 AM WAT (09:56 UTC) -> past 10:55 AM WAT -> throws!
  assert.throws(
    () => {
      const draft = manager.createDraft({
        unitId: unit.id,
        primaryGuest: { id: "guest-101", name: "Tunde Ednut", isGovernmentIdVerified: true },
        selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
        occupants: [{ name: "Tunde Ednut" }],
        checkIn: "2026-07-22",
        checkOut: "2026-07-24",
        clock: () => new Date("2026-07-22T09:56:00Z") // 10:56 WAT
      });
      const env = createPlatformCommandEnvelope({
        commandName: "booking_request.disclose",
        principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
        payload: { draftId: draft.draftId }
      });
      manager.discloseBookingRequest(env, { clock: () => new Date("2026-07-22T09:56:00Z") });
    },
    /Latest Disclosure Cutoff/i
  );

  // Same-day check-in disclosed at 10:50 AM WAT (09:50 UTC) -> <= 10:55 AM WAT -> succeeds!
  const validSameDayDraft = manager.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "guest-101", name: "Tunde Ednut", isGovernmentIdVerified: true },
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    occupants: [{ name: "Tunde Ednut" }],
    checkIn: "2026-07-22",
    checkOut: "2026-07-24",
    clock: () => new Date("2026-07-22T09:50:00Z") // 10:50 WAT
  });
  const validSameDayEnv = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-101", role: "guest", tenantId: "tenant-lagos" },
    payload: { draftId: validSameDayDraft.draftId }
  });
  const disclosedSameDay = manager.discloseBookingRequest(validSameDayEnv, { clock: () => new Date("2026-07-22T09:50:00Z") });
  assert.equal(disclosedSameDay.status, "disclosed");
});

test("Technical delivery, delivery failure, Operator response, expiry, confirmation, and decline are distinct auditable events", () => {
  const { manager, audit, calendar, unit } = setup();

  // Test 1: Technical delivery & Confirmation
  const clock1 = () => new Date("2026-07-22T10:00:00Z"); // 11:00 WAT
  const draft1 = manager.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "guest-1", name: "Kemi Adetiba", isGovernmentIdVerified: true },
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    occupants: [{ name: "Kemi Adetiba" }],
    checkIn: "2026-08-05",
    checkOut: "2026-08-08",
    clock: clock1
  });

  const discloseEnv1 = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-1", role: "guest", tenantId: "tenant-lagos" },
    payload: { draftId: draft1.draftId }
  });
  const req1 = manager.discloseBookingRequest(discloseEnv1, { clock: clock1 });
  assert.equal(req1.delivered, true);

  const confirmEnv1 = createPlatformCommandEnvelope({
    commandName: "booking_request.confirm",
    principal: { id: unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
    payload: { requestId: req1.requestId }
  });
  const confirmedReq = manager.confirmBookingRequest(confirmEnv1, { clock: () => new Date("2026-07-22T10:10:00Z") });
  assert.equal(confirmedReq.status, "confirmed");

  // Check audit log for req1
  const entries1 = audit.entries().filter((e) => e.requestId === req1.requestId);
  const types1 = entries1.map((e) => e.type);
  assert.ok(types1.includes("booking_request.disclosed"));
  assert.ok(types1.includes("booking_request.delivered"));
  assert.ok(types1.includes("booking_request.operator_responded"));
  assert.ok(types1.includes("booking_request.confirmed"));

  // Test 2: Technical Delivery Failure (ADR 0043)
  const draftDeliveryFail = manager.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "guest-df", name: "David Adeleke", isGovernmentIdVerified: true },
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    occupants: [{ name: "David Adeleke" }],
    checkIn: "2026-08-08",
    checkOut: "2026-08-10",
    clock: clock1
  });

  const discloseEnvDF = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-df", role: "guest", tenantId: "tenant-lagos" },
    payload: { draftId: draftDeliveryFail.draftId, autoDeliver: false }
  });
  const reqDF = manager.discloseBookingRequest(discloseEnvDF, { clock: clock1 });
  assert.equal(reqDF.delivered, false);

  // Advance clock +6 minutes (past 5-min delivery deadline)
  const clockAfterDeliveryDeadline = () => new Date("2026-07-22T10:06:00Z");
  const failEnv = createPlatformCommandEnvelope({
    commandName: "booking_request.delivery_failed",
    principal: { id: "system", role: "system" },
    payload: { requestId: reqDF.requestId }
  });
  const failedReq = manager.checkAndResolveDeliveryFailure(failEnv, { clock: clockAfterDeliveryDeadline });
  assert.equal(failedReq.status, "delivery_failed");

  // Verify inventory hold is released upon delivery failure
  assert.equal(calendar.getAuthoritativeAvailability({ unitId: unit.id, checkIn: "2026-08-08", checkOut: "2026-08-10", clock: clockAfterDeliveryDeadline }).isAvailable, true);

  const dfAudit = audit.entries().find((e) => e.requestId === reqDF.requestId && e.type === "booking_request.delivery_failed");
  assert.ok(dfAudit);
  assert.equal(dfAudit.commandEnvelopeId, failEnv.commandId);

  // Test 3: Decline releases inventory hold immediately
  const draft2 = manager.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "guest-2", name: "Bolu Tokunbo", isGovernmentIdVerified: true },
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    occupants: [{ name: "Bolu Tokunbo" }],
    checkIn: "2026-08-10",
    checkOut: "2026-08-12",
    clock: clock1
  });
  const discloseEnv2 = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-2", role: "guest", tenantId: "tenant-lagos" },
    payload: { draftId: draft2.draftId }
  });
  const req2 = manager.discloseBookingRequest(discloseEnv2, { clock: clock1 });
  assert.equal(calendar.getAuthoritativeAvailability({ unitId: unit.id, checkIn: "2026-08-10", checkOut: "2026-08-12", clock: clock1 }).isAvailable, false);

  const declineEnv2 = createPlatformCommandEnvelope({
    commandName: "booking_request.decline",
    principal: { id: unit.operator.id, role: "operator", tenantId: "tenant-lagos" },
    payload: { requestId: req2.requestId, reason: "Dates reserved for family" }
  });
  const declinedReq = manager.declineBookingRequest(declineEnv2, { clock: () => new Date("2026-07-22T10:05:00Z") });
  assert.equal(declinedReq.status, "declined");

  // Verify inventory is unblocked
  assert.equal(calendar.getAuthoritativeAvailability({ unitId: unit.id, checkIn: "2026-08-10", checkOut: "2026-08-12", clock: clock1 }).isAvailable, true);

  const entries2 = audit.entries().filter((e) => e.requestId === req2.requestId);
  const types2 = entries2.map((e) => e.type);
  assert.ok(types2.includes("booking_request.declined"));

  // Test 4: Expiry after 30 minutes unblocks inventory automatically (ADR 0072: command envelope)
  const draft3 = manager.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "guest-3", name: "Seyi Shay", isGovernmentIdVerified: true },
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    occupants: [{ name: "Seyi Shay" }],
    checkIn: "2026-08-15",
    checkOut: "2026-08-18",
    clock: clock1
  });
  const discloseEnv3 = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-3", role: "guest", tenantId: "tenant-lagos" },
    payload: { draftId: draft3.draftId }
  });
  const req3 = manager.discloseBookingRequest(discloseEnv3, { clock: clock1 });

  // Clock ticks +31 minutes (no operator response)
  const clockAfterExpiry = () => new Date("2026-07-22T10:31:00Z");
  const expireEnv = createPlatformCommandEnvelope({
    commandName: "booking_request.expire",
    principal: { id: "system", role: "system" },
    payload: { requestId: req3.requestId }
  });
  const expiredReq = manager.checkAndResolveExpiry(expireEnv, { clock: clockAfterExpiry });
  assert.equal(expiredReq.status, "expired");

  // Verify inventory is unblocked after expiry
  assert.equal(calendar.getAuthoritativeAvailability({ unitId: unit.id, checkIn: "2026-08-15", checkOut: "2026-08-18", clock: clockAfterExpiry }).isAvailable, true);

  const entries3 = audit.entries().filter((e) => e.requestId === req3.requestId);
  const types3 = entries3.map((e) => e.type);
  assert.ok(types3.includes("booking_request.expired"));
  const expireAudit = entries3.find((e) => e.type === "booking_request.expired");
  assert.equal(expireAudit.commandEnvelopeId, expireEnv.commandId);
});

test("A disclosed Booking Request creates an explicit 30-minute booking request block", () => {
  const { manager, calendar, unit } = setup();
  const clock = () => new Date("2026-07-22T10:00:00Z");
  const draft = manager.createDraft({ unitId: unit.id, primaryGuest: { id: "guest-block", name: "Block Guest", isGovernmentIdVerified: true }, selfBookingAttestation: { accepted: true, version: "self-booking-v1" }, occupants: [{ name: "Block Guest" }], checkIn: "2026-08-25", checkOut: "2026-08-27", clock });
  const request = manager.discloseBookingRequest(createPlatformCommandEnvelope({ commandName: "booking_request.disclose", principal: { id: "guest-block", role: "guest", tenantId: "tenant-lagos" }, payload: { draftId: draft.draftId } }), { clock });

  assert.equal(request.inventoryCommitmentId, request.holdId);
  assert.ok(request.inventoryCommitmentId);
  const commitment = calendar.assertActiveCommitment({ commitmentId: request.inventoryCommitmentId, unitId: unit.id, start: request.checkIn, end: request.checkOut, expectedKind: "booking_request_block", clock });
  assert.equal(commitment.kind, "booking_request_block");
  assert.equal(commitment.expiresAt, "2026-07-22T10:30:00.000Z");
  assert.equal(calendar.getAuthoritativeAvailability({ unitId: unit.id, checkIn: request.checkIn, checkOut: request.checkOut, clock }).isAvailable, false);
  assert.throws(() => calendar.createBookingRequestBlock({ unitId: unit.id, holderId: "other", start: request.checkIn, end: request.checkOut, clock }), /availability conflict/i);

  calendar.releaseBookingRequestBlock(request.inventoryCommitmentId, { clock });
  assert.throws(
    () => manager.confirmBookingRequest(createPlatformCommandEnvelope({ commandName: "booking_request.confirm", principal: { id: unit.operator.id, role: "operator", tenantId: "tenant-lagos" }, payload: { requestId: request.requestId } }), { clock }),
    /booking request block is no longer valid/i
  );
  assert.equal(manager.getRequest(request.requestId).status, "disclosed");
  assert.equal(calendar.getAuthoritativeAvailability({ unitId: unit.id, checkIn: request.checkIn, checkOut: request.checkOut, clock }).isAvailable, true);
});

test("Booking Request confirmation atomically transitions the same commitment to Payment Pending", () => {
  const { manager, calendar, unit } = setup();
  const disclosureClock = () => new Date("2026-07-22T10:00:00Z");
  const confirmationClock = () => new Date("2026-07-22T10:10:00Z");
  const draft = manager.createDraft({ unitId: unit.id, primaryGuest: { id: "guest-confirm", name: "Confirm Guest", isGovernmentIdVerified: true }, selfBookingAttestation: { accepted: true, version: "self-booking-v1" }, occupants: [{ name: "Confirm Guest" }], checkIn: "2026-09-01", checkOut: "2026-09-04", clock: disclosureClock });
  const request = manager.discloseBookingRequest(createPlatformCommandEnvelope({ commandName: "booking_request.disclose", principal: { id: "guest-confirm", role: "guest", tenantId: "tenant-lagos" }, payload: { draftId: draft.draftId } }), { clock: disclosureClock });
  const confirmed = manager.confirmBookingRequest(createPlatformCommandEnvelope({ commandName: "booking_request.confirm", principal: { id: unit.operator.id, role: "operator", tenantId: "tenant-lagos" }, payload: { requestId: request.requestId } }), { clock: confirmationClock });

  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.inventoryCommitmentId, request.inventoryCommitmentId);
  const commitment = calendar.assertActiveCommitment({ commitmentId: request.inventoryCommitmentId, unitId: unit.id, start: request.checkIn, end: request.checkOut, expectedKind: "payment_pending", clock: confirmationClock });
  assert.equal(commitment.kind, "payment_pending");
  assert.equal(commitment.expiresAt, "2026-07-22T10:30:00.000Z");
  assert.equal(calendar.getAuthoritativeAvailability({ unitId: unit.id, checkIn: request.checkIn, checkOut: request.checkOut, clock: confirmationClock }).isAvailable, false);
  assert.throws(() => calendar.assertActiveCommitment({ commitmentId: request.inventoryCommitmentId, unitId: unit.id, start: request.checkIn, end: request.checkOut, expectedKind: "booking_request_block", clock: confirmationClock }), /no longer valid/i);
});

test("Disclosure and confirmation use one captured instant with an advancing clock", () => {
  const { manager, calendar, unit } = setup();
  const draftClock = () => new Date("2026-07-22T09:00:00Z");
  const disclosureStart = new Date("2026-07-22T10:00:00Z");
  let disclosureCalls = 0;
  const disclosureClock = () => new Date(disclosureStart.getTime() + disclosureCalls++ * 60 * 1000);
  const draft = manager.createDraft({ unitId: unit.id, primaryGuest: { id: "guest-clock", name: "Clock Guest", isGovernmentIdVerified: true }, selfBookingAttestation: { accepted: true, version: "self-booking-v1" }, occupants: [{ name: "Clock Guest" }], checkIn: "2026-10-01", checkOut: "2026-10-04", clock: draftClock });
  const request = manager.discloseBookingRequest(createPlatformCommandEnvelope({ commandName: "booking_request.disclose", principal: { id: "guest-clock", role: "guest", tenantId: "tenant-lagos" }, payload: { draftId: draft.draftId } }), { clock: disclosureClock });
  const disclosureT = disclosureStart.toISOString();
  const disclosureExpiry = new Date(disclosureStart.getTime() + 30 * 60 * 1000).toISOString();

  assert.equal(request.disclosedAt, disclosureT);
  assert.equal(request.operatorResponseDeadlineAt, disclosureExpiry);
  assert.ok(request.inventoryCommitmentId);
  const block = calendar.assertActiveCommitment({ commitmentId: request.inventoryCommitmentId, unitId: unit.id, start: request.checkIn, end: request.checkOut, expectedKind: "booking_request_block", clock: () => disclosureStart });
  assert.equal(block.createdAt, disclosureT);
  assert.equal(block.expiresAt, disclosureExpiry);
  assert.equal(block.expiresAt, request.operatorResponseDeadlineAt);

  const confirmationStart = new Date("2026-07-22T10:10:00Z");
  let confirmationCalls = 0;
  const confirmationClock = () => new Date(confirmationStart.getTime() + confirmationCalls++ * 60 * 1000);
  const confirmed = manager.confirmBookingRequest(createPlatformCommandEnvelope({ commandName: "booking_request.confirm", principal: { id: unit.operator.id, role: "operator", tenantId: "tenant-lagos" }, payload: { requestId: request.requestId } }), { clock: confirmationClock });
  const confirmationC = confirmationStart.toISOString();
  const paymentExpiry = new Date(confirmationStart.getTime() + 20 * 60 * 1000).toISOString();

  assert.equal(confirmed.confirmedAt, confirmationC);
  assert.equal(confirmed.inventoryCommitmentId, request.inventoryCommitmentId);
  const paymentPending = calendar.assertActiveCommitment({ commitmentId: request.inventoryCommitmentId, unitId: unit.id, start: request.checkIn, end: request.checkOut, expectedKind: "payment_pending", clock: () => confirmationStart });
  assert.equal(paymentPending.expiresAt, paymentExpiry);
  assert.equal(paymentPending.expiresAt, new Date(new Date(confirmed.confirmedAt).getTime() + 20 * 60 * 1000).toISOString());
});

test("Agent, conventional web, and permitted Operator interfaces produce the same Platform Command Envelope and outcome", () => {
  const { manager, unit } = setup();
  const clock = () => new Date("2026-07-22T10:00:00Z");

  const draft = manager.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "guest-505", name: "Wande Coal", isGovernmentIdVerified: true },
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    occupants: [{ name: "Wande Coal" }],
    checkIn: "2026-08-20",
    checkOut: "2026-08-22",
    clock
  });

  // Agent interface envelope
  const agentEnvelope = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "agent-run-123", role: "agent", tenantId: "tenant-lagos" },
    payload: { draftId: draft.draftId }
  });

  // Conventional web envelope
  const webEnvelope = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-505", role: "guest", tenantId: "tenant-lagos" },
    payload: { draftId: draft.draftId }
  });

  // Both envelopes carry the required command envelope shape
  assert.equal(agentEnvelope.commandName, "booking_request.disclose");
  assert.equal(webEnvelope.commandName, "booking_request.disclose");
  assert.ok(agentEnvelope.commandId);
  assert.ok(webEnvelope.commandId);

  // An agent cannot disclose another principal's Primary Guest request.
  assert.throws(
    () => manager.discloseBookingRequest(agentEnvelope, { clock }),
    /Primary Guest/i
  );
  const res1 = manager.discloseBookingRequest(webEnvelope, { clock });
  assert.equal(res1.status, "disclosed");
  assert.equal(res1.unitId, unit.id);
});

test("Booking Request disclosure always verifies guests, requires trusted tenant, and preserves minimized state", () => {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const audit = new InMemoryAuditLog();
  const calendar = new AvailabilityCalendar({ repository, audit });
  const verificationResults: GuestIdentityVerificationResultSource = {
    getVerificationResult: ({ tenantId, guestId }) => ({
      tenantId,
      guestId,
      governmentIdVerified: guestId !== "guest-unverified"
    })
  };
  const manager = new BookingRequestManager({
    repository,
    audit,
    calendar,
    guestVerification: new GuestVerificationService({ repository, verificationResults })
  });
  const unit = repository.findAll()[0];
  const clock = () => new Date("2026-07-22T10:00:00Z");

  const unverifiedDraft = manager.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "guest-unverified", name: "Unverified Guest", isGovernmentIdVerified: false },
    occupants: [{ name: "Unverified Guest" }],
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    checkIn: "2026-08-01",
    checkOut: "2026-08-03"
  });
  assert.throws(
    () => manager.discloseBookingRequest(createPlatformCommandEnvelope({
      commandName: "booking_request.disclose",
      principal: { id: "guest-unverified", role: "guest", tenantId: "tenant-lagos" },
      payload: { draftId: unverifiedDraft.draftId }
    }), { clock }),
    /Unverified Primary Guest/i
  );
  assert.equal(calendar.getAuthoritativeAvailability({ unitId: unit.id, checkIn: "2026-08-01", checkOut: "2026-08-03", clock }).isAvailable, true);
  assert.equal(audit.entries().some((entry) => entry.type === "booking_request.disclosed"), false);

  const rawDraft = manager.createDraft({
    unitId: unit.id,
    primaryGuest: {
      id: "guest-A",
      name: "Safe Guest",
      isGovernmentIdVerified: true,
      ninNumber: "secret"
    },
    occupants: [{ name: "Safe Guest", rawEvidence: "secret" }],
    selfBookingAttestation: { accepted: true, version: "self-booking-v1", rawEvidence: "secret" },
    distinctPayer: {
      id: "payer-B",
      name: "Distinct Payer",
      passportNumber: "secret",
      ninNumber: "secret",
      rawEvidence: "secret",
      fullAddress: "secret",
      riskScore: 99
    },
    distinctPayerAttestation: { accepted: true, version: "distinct-payer-v1", rawEvidence: "secret" },
    checkIn: "2026-08-05",
    checkOut: "2026-08-07"
  } as any);
  assert.equal((rawDraft.primaryGuest as Record<string, unknown>).ninNumber, undefined);
  assert.equal((rawDraft.distinctPayer as Record<string, unknown>).passportNumber, undefined);
  assert.equal((rawDraft.distinctPayer as Record<string, unknown>).ninNumber, undefined);
  assert.equal((rawDraft.distinctPayer as Record<string, unknown>).rawEvidence, undefined);
  assert.equal((rawDraft.distinctPayer as Record<string, unknown>).fullAddress, undefined);
  assert.equal((rawDraft.distinctPayer as Record<string, unknown>).riskScore, undefined);
  assert.deepEqual(Object.keys(rawDraft.distinctPayer ?? {}).sort(), ["id", "name"]);
  assert.equal((rawDraft.occupants[0] as unknown as Record<string, unknown>).rawEvidence, undefined);
  const request = manager.discloseBookingRequest(createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-A", role: "guest", tenantId: "tenant-lagos" },
    payload: { draftId: rawDraft.draftId }
  }), { clock });
  assert.equal(request.tenantId, "tenant-lagos");
  assert.equal((request.primaryGuest as Record<string, unknown>).ninNumber, undefined);
  assert.equal(request.primaryGuest.isGovernmentIdVerified, true);
  assert.deepEqual(request.distinctPayer, { id: "payer-B", name: "Distinct Payer" });
  assert.notEqual(request.distinctPayer?.id, request.primaryGuest.id);
  assert.equal((request.distinctPayer as Record<string, unknown>).passportNumber, undefined);
  assert.equal((request.distinctPayer as Record<string, unknown>).ninNumber, undefined);
  assert.equal((request.distinctPayer as Record<string, unknown>).rawEvidence, undefined);
  assert.equal((request.distinctPayer as Record<string, unknown>).fullAddress, undefined);
  assert.equal((request.distinctPayer as Record<string, unknown>).riskScore, undefined);
  assert.deepEqual(Object.keys(request.distinctPayer ?? {}).sort(), ["id", "name"]);
  assert.equal((request.occupants[0] as Record<string, unknown>).rawEvidence, undefined);
  const disclosureAudit = audit.entries().find((entry) => entry.type === "booking_request.disclosed" && entry.requestId === request.requestId);
  assert.equal(disclosureAudit?.primaryGuestId, "guest-A");
  assert.equal(disclosureAudit?.attestedByPrincipalId, "guest-A");
  assert.equal(disclosureAudit?.selfBookingAttestationVersion, "self-booking-v1");
  assert.equal(disclosureAudit?.distinctPayerAttestationVersion, "distinct-payer-v1");
  assert.equal(disclosureAudit?.rawEvidence, undefined);
  assert.equal(disclosureAudit?.occupants, undefined);
  assert.equal(disclosureAudit?.distinctPayer, undefined);

  const missingTenantDraft = manager.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "guest-missing-tenant", name: "Missing Tenant", isGovernmentIdVerified: true },
    occupants: [{ name: "Missing Tenant" }],
    selfBookingAttestation: { accepted: true, version: "self-booking-v1" },
    checkIn: "2026-08-10",
    checkOut: "2026-08-12"
  });
  assert.throws(
    () => manager.discloseBookingRequest(createPlatformCommandEnvelope({
      commandName: "booking_request.disclose",
      principal: { id: "guest-missing-tenant", role: "guest" },
      payload: { draftId: missingTenantDraft.draftId }
    }), { clock }),
    /tenant/i
  );
});
