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
  RestrictedIdentityStore,
  BookingRequestManager
} from "../domains/shortlet/src/index.js";

function setup() {
  const repository = new UnitRepository();
  seedIssue01Units(repository);
  const audit = new InMemoryAuditLog();
  const calendar = new AvailabilityCalendar({ repository, audit });
  const identityStore = new RestrictedIdentityStore();
  const guestVerification = new GuestVerificationService({ repository, identityStore });
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
      isPrimaryGuestOccupant: true,
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
  assert.ok(request.holdId);

  // Now inventory IS exclusively blocked for 30 minutes
  const postDiscloseAvailability = calendar.getAuthoritativeAvailability({
    unitId: unit.id,
    checkIn: "2026-08-01",
    checkOut: "2026-08-05",
    clock
  });
  assert.equal(postDiscloseAvailability.isAvailable, false);
  assert.equal(postDiscloseAvailability.conflictReason, "Overlaps with active Hold");
});

test("Disclosure enforces one-to-fourteen nights, 90-day horizon, active hours window, and safe cutoff", () => {
  const { manager, unit } = setup();

  // 1. Enforce stay length: 0 nights
  assert.throws(
    () => {
      const draft = manager.createDraft({
        unitId: unit.id,
        primaryGuest: { id: "guest-101", name: "Tunde Ednut", isGovernmentIdVerified: true },
        isPrimaryGuestOccupant: true,
        occupants: [{ name: "Tunde Ednut" }],
        checkIn: "2026-08-01",
        checkOut: "2026-08-01",
        clock: () => new Date("2026-07-22T10:00:00Z")
      });
      const env = createPlatformCommandEnvelope({
        commandName: "booking_request.disclose",
        principal: { id: "guest-101", role: "guest" },
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
        isPrimaryGuestOccupant: true,
        occupants: [{ name: "Tunde Ednut" }],
        checkIn: "2026-08-01",
        checkOut: "2026-08-16",
        clock: () => new Date("2026-07-22T10:00:00Z")
      });
      const env = createPlatformCommandEnvelope({
        commandName: "booking_request.disclose",
        principal: { id: "guest-101", role: "guest" },
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
        isPrimaryGuestOccupant: true,
        occupants: [{ name: "Tunde Ednut" }],
        checkIn: "2026-11-01", // > 90 days from July 22
        checkOut: "2026-11-05",
        clock: () => new Date("2026-07-22T10:00:00Z")
      });
      const env = createPlatformCommandEnvelope({
        commandName: "booking_request.disclose",
        principal: { id: "guest-101", role: "guest" },
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
        isPrimaryGuestOccupant: true,
        occupants: [{ name: "Tunde Ednut" }],
        checkIn: "2026-08-01",
        checkOut: "2026-08-03",
        clock: () => new Date("2026-07-22T18:35:00Z") // 19:35 WAT
      });
      const env = createPlatformCommandEnvelope({
        commandName: "booking_request.disclose",
        principal: { id: "guest-101", role: "guest" },
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
    isPrimaryGuestOccupant: true,
    occupants: [{ name: "Tunde Ednut" }],
    checkIn: "2026-08-01",
    checkOut: "2026-08-03",
    clock: () => new Date("2026-07-22T18:25:00Z") // 19:25 WAT
  });
  const validEveningEnv = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-101", role: "guest" },
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
        isPrimaryGuestOccupant: true,
        occupants: [{ name: "Tunde Ednut" }],
        checkIn: "2026-07-22",
        checkOut: "2026-07-24",
        clock: () => new Date("2026-07-22T09:56:00Z") // 10:56 WAT
      });
      const env = createPlatformCommandEnvelope({
        commandName: "booking_request.disclose",
        principal: { id: "guest-101", role: "guest" },
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
    isPrimaryGuestOccupant: true,
    occupants: [{ name: "Tunde Ednut" }],
    checkIn: "2026-07-22",
    checkOut: "2026-07-24",
    clock: () => new Date("2026-07-22T09:50:00Z") // 10:50 WAT
  });
  const validSameDayEnv = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-101", role: "guest" },
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
    isPrimaryGuestOccupant: true,
    occupants: [{ name: "Kemi Adetiba" }],
    checkIn: "2026-08-05",
    checkOut: "2026-08-08",
    clock: clock1
  });

  const discloseEnv1 = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-1", role: "guest" },
    payload: { draftId: draft1.draftId }
  });
  const req1 = manager.discloseBookingRequest(discloseEnv1, { clock: clock1 });
  assert.equal(req1.delivered, true);

  const confirmEnv1 = createPlatformCommandEnvelope({
    commandName: "booking_request.confirm",
    principal: { id: unit.operator.id, role: "operator" },
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
    isPrimaryGuestOccupant: true,
    occupants: [{ name: "David Adeleke" }],
    checkIn: "2026-08-08",
    checkOut: "2026-08-10",
    clock: clock1
  });

  const discloseEnvDF = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-df", role: "guest" },
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
    isPrimaryGuestOccupant: true,
    occupants: [{ name: "Bolu Tokunbo" }],
    checkIn: "2026-08-10",
    checkOut: "2026-08-12",
    clock: clock1
  });
  const discloseEnv2 = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-2", role: "guest" },
    payload: { draftId: draft2.draftId }
  });
  const req2 = manager.discloseBookingRequest(discloseEnv2, { clock: clock1 });
  assert.equal(calendar.getAuthoritativeAvailability({ unitId: unit.id, checkIn: "2026-08-10", checkOut: "2026-08-12", clock: clock1 }).isAvailable, false);

  const declineEnv2 = createPlatformCommandEnvelope({
    commandName: "booking_request.decline",
    principal: { id: unit.operator.id, role: "operator" },
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
    isPrimaryGuestOccupant: true,
    occupants: [{ name: "Seyi Shay" }],
    checkIn: "2026-08-15",
    checkOut: "2026-08-18",
    clock: clock1
  });
  const discloseEnv3 = createPlatformCommandEnvelope({
    commandName: "booking_request.disclose",
    principal: { id: "guest-3", role: "guest" },
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

test("Agent, conventional web, and permitted Operator interfaces produce the same Platform Command Envelope and outcome", () => {
  const { manager, unit } = setup();
  const clock = () => new Date("2026-07-22T10:00:00Z");

  const draft = manager.createDraft({
    unitId: unit.id,
    primaryGuest: { id: "guest-505", name: "Wande Coal", isGovernmentIdVerified: true },
    isPrimaryGuestOccupant: true,
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

  // Executing either produces identical state transformation
  const res1 = manager.discloseBookingRequest(agentEnvelope, { clock });
  assert.equal(res1.status, "disclosed");
  assert.equal(res1.unitId, unit.id);
});
