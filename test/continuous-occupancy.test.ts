import assert from "node:assert/strict";
import test from "node:test";
import {
  BookingAmendmentManager,
  ContinuousOccupancyError,
  SELF_BOOKING_ATTESTATION_VERSION,
  ContinuousOccupancyLedger,
  EXTENDED_STAY_POLICY,
  MAX_STAY_NIGHTS,
  assertContinuousOccupancy,
  assessContinuousOccupancy,
  continuousOccupancyRefusal,
  type BookingContract,
  type OccupancyStay,
} from "../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";
import {
  GUEST,
  OCCUPANCY_TENANT,
  OTHER_GUEST,
  OTHER_PROPERTY,
  OTHER_TENANT,
  PROPERTY,
  UNIT_A,
  UNIT_B,
  UNIT_OTHER_PROPERTY,
  amendmentDependencies,
  confirmedStayFor,
  confirmStay,
  disclose,
  draftFor,
  fixedOccupancyLedger,
  guestPrincipal,
  occupancyManager,
  occupancyUnits,
  openOccupancyStores,
  storedRequest,
} from "./helpers/continuous-occupancy-fixture.js";

// ADR 0023 as amended 1 Nov 2026 (Short Stays of 1 to 29 nights; Continuous Occupancy aggregated across units at one
// Property; the same Primary Guest only; a gap of one night breaks the chain), ADR 0092 (Extended Stay chain of 180 nights),
// ADR 0060 (amendments validated), ADR 0075 (no guest identifiers in refusals). Issue 04 owner decisions apply.

const CHECK_IN = "2026-08-01";
const NOW = new Date("2026-07-22T10:00:00.000Z");
const clock = () => NOW;

function stay(ref: string, checkIn: string, checkOut: string, overrides: Partial<OccupancyStay> = {}): OccupancyStay {
  const nights = (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000;
  return {
    ref,
    unitId: UNIT_A,
    propertyId: PROPERTY,
    checkIn,
    checkOut,
    nights,
    stayType: nights <= MAX_STAY_NIGHTS ? "short" : "extended",
    ...overrides,
  };
}

test("AC1: A guest with a confirmed 20-night Short Stay at Property P cannot submit a Booking Request at another Unit of P that checks in on that checkout date for 10 nights (30 in total); the refusal names the total, and no nights are held.", () => {
  const repository = occupancyUnits();
  const stores = openOccupancyStores();
  try {
    const { manager, calendar } = occupancyManager({ repository, clock, stores });
    // The Request Draft is made before the confirmed stay exists, so the submit-time check is the one under test.
    const draftB = draftFor(manager, clock, { unitId: UNIT_B, checkIn: "2026-08-21", checkOut: "2026-08-31" });
    confirmedStayFor(stores, manager, clock, { unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-21" });

    assert.throws(() => disclose(manager, clock, draftB.draftId), (error: unknown) => {
      assert.ok(error instanceof ContinuousOccupancyError, "the refusal is a ContinuousOccupancyError");
      assert.equal(error.total, 30);
      assert.match(error.message, /making 30 nights/);
      return true;
    }, "submit refuses the 30-night chain");
    assert.equal(calendar.getAuthoritativeAvailability({ unitId: UNIT_B, checkIn: "2026-08-21", checkOut: "2026-08-31", clock }).isAvailable, true, "no nights are held at Unit B");
    assert.equal(manager.getDraft(draftB.draftId).status, "draft", "the draft stays a draft");

    // Draft creation refuses the same chain, before any hold.
    assert.throws(() => draftFor(manager, clock, { unitId: UNIT_B, checkIn: "2026-08-21", checkOut: "2026-08-31" }), (error: unknown) => error instanceof ContinuousOccupancyError && error.total === 30, "draft creation refuses the chain");
  } finally {
    stores.close();
  }
});

test("AC2: The same guest can book 9 nights there (29 in total).", () => {
  const repository = occupancyUnits();
  const stores = openOccupancyStores();
  try {
    const { manager } = occupancyManager({ repository, clock, stores });
    confirmedStayFor(stores, manager, clock, { unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-21" });
    const draft = draftFor(manager, clock, { unitId: UNIT_B, checkIn: "2026-08-21", checkOut: "2026-08-30" });
    const request = disclose(manager, clock, draft.draftId);
    assert.equal(request.status, "disclosed");
    assert.equal(request.nights, 9);
  } finally {
    stores.close();
  }
});

test("AC3: A one-night gap breaks the chain: 20 nights, a gap night, then 20 nights is allowed.", () => {
  const repository = occupancyUnits();
  const stores = openOccupancyStores();
  try {
    const { manager } = occupancyManager({ repository, clock, stores });
    confirmedStayFor(stores, manager, clock, { unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-21" });
    const afterGap = draftFor(manager, clock, { unitId: UNIT_B, checkIn: "2026-08-22", checkOut: "2026-09-11" });
    assert.equal(disclose(manager, clock, afterGap.draftId).nights, 20, "20 nights after a gap night is allowed");
    assert.throws(() => draftFor(manager, clock, { unitId: UNIT_B, checkIn: "2026-08-21", checkOut: "2026-09-10" }), ContinuousOccupancyError, "the same 20 nights with no gap is refused");
  } finally {
    stores.close();
  }
});

test("AC4: A different guest account, or a different Property, is never added to the chain.", () => {
  const repository = occupancyUnits();
  const stores = openOccupancyStores();
  try {
    const { manager } = occupancyManager({ repository, clock, stores });
    // Another guest's 20 nights ends on the candidate's check-in at the same Property.
    confirmedStayFor(stores, manager, clock, { unitId: UNIT_A, guestId: OTHER_GUEST, checkIn: "2026-08-01", checkOut: "2026-08-21" });
    // The guest's own 20 nights end on the same day at another Property.
    confirmedStayFor(stores, manager, clock, { unitId: UNIT_OTHER_PROPERTY, checkIn: "2026-08-01", checkOut: "2026-08-21" });
    const draft = draftFor(manager, clock, { unitId: UNIT_B, checkIn: "2026-08-21", checkOut: "2026-08-31" });
    assert.equal(disclose(manager, clock, draft.draftId).nights, 10, "10 nights are allowed: neither stay is in the chain");
  } finally {
    stores.close();
  }
});

test("AC5: Declined, expired and cancelled stays are not counted; a pending Booking Request and an open Conditional Offer are counted.", () => {
  const scenario = (
    label: string,
    setup: (stores: ReturnType<typeof openOccupancyStores>, manager: ReturnType<typeof occupancyManager>["manager"], later: { now: Date }) => void,
    expectation: "allowed" | "refused",
  ) => {
    const repository = occupancyUnits();
    const stores = openOccupancyStores();
    try {
      const later = { now: NOW };
      const at = () => later.now;
      const managed = occupancyManager({ repository, clock: at, stores });
      setup(stores, managed.manager, later);
      const attempt = () => draftFor(managed.manager, at, { unitId: UNIT_B, checkIn: "2026-08-21", checkOut: "2026-08-31" });
      if (expectation === "allowed") assert.equal(attempt().status, "draft", `${label}: allowed`);
      else assert.throws(attempt, ContinuousOccupancyError, `${label}: refused`);
    } finally {
      stores.close();
    }
  };

  scenario("declined", (stores, manager) => {
    const draft = draftFor(manager, clock, { unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-21" });
    const requestId = disclose(manager, clock, draft.draftId).requestId;
    stores.store.saveBookingRequest({ ...storedRequest(stores, requestId), status: "declined", declinedAt: NOW.toISOString(), declineReason: "unit" });
  }, "allowed");

  scenario("expired (the Operator did not respond in 30 minutes)", (_stores, manager, later) => {
    const draft = draftFor(manager, clock, { unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-21" });
    disclose(manager, clock, draft.draftId);
    later.now = new Date(NOW.getTime() + 31 * 60_000);
  }, "allowed");

  scenario("delivery failed", (stores, manager) => {
    const draft = draftFor(manager, clock, { unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-21" });
    const requestId = disclose(manager, clock, draft.draftId).requestId;
    stores.store.saveBookingRequest({ ...storedRequest(stores, requestId), status: "delivery_failed", delivered: false });
  }, "allowed");

  scenario("cancelled reservation", (stores, manager) => {
    confirmedStayFor(stores, manager, clock, { unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-21", reservationStatus: "cancelled" });
  }, "allowed");

  scenario("expired conditional offer", (stores, manager) => {
    const draft = draftFor(manager, clock, { unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-21" });
    const requestId = disclose(manager, clock, draft.draftId).requestId;
    confirmStay(stores, storedRequest(stores, requestId), { offerStatus: "expired", at: NOW.toISOString() });
  }, "allowed");

  scenario("pending Booking Request awaiting the Operator", (_stores, manager) => {
    const draft = draftFor(manager, clock, { unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-21" });
    disclose(manager, clock, draft.draftId);
  }, "refused");

  scenario("open Conditional Offer", (stores, manager) => {
    const draft = draftFor(manager, clock, { unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-21" });
    const requestId = disclose(manager, clock, draft.draftId).requestId;
    confirmStay(stores, storedRequest(stores, requestId), { offerStatus: "issued", at: NOW.toISOString() });
  }, "refused");
});

test("AC6: A chain that includes an Extended Stay may reach 180 nights and is refused at 181.", () => {
  const repository = occupancyUnits({ extended: true });
  const stores = openOccupancyStores();
  try {
    const { manager } = occupancyManager({ repository, clock, stores, extendedStayPolicy: EXTENDED_STAY_POLICY });
    // A 30-night Extended Stay ends on 31 August; the chain may run to 180 nights in total.
    confirmedStayFor(stores, manager, clock, { unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-31" });
    // 151 more nights make 181 in total: refused at draft creation, before any 150-night stay is counted.
    assert.throws(() => draftFor(manager, clock, { unitId: UNIT_B, checkIn: "2026-08-31", checkOut: "2027-01-29" }), (error: unknown) => {
      assert.ok(error instanceof ContinuousOccupancyError);
      assert.equal(error.total, 181);
      assert.equal(error.limit, 180);
      assert.match(error.message, /making 181 nights, more than the 180-night maximum\./);
      return true;
    }, "151 more nights make 181 in total and are refused");
    // 150 more nights make exactly 180 in total and are allowed.
    const reaching180 = draftFor(manager, clock, { unitId: UNIT_B, checkIn: "2026-08-31", checkOut: "2027-01-28" });
    assert.equal(disclose(manager, clock, reaching180.draftId).nights, 150, "150 more nights make 180 in total");
  } finally {
    stores.close();
  }
});

test("AC7: A Booking Amendment that extends a stay into a chain over the limit is refused.", () => {
  const contractId = "ctr-occupancy-amend";
  const contract = {
    contractId,
    reservationId: "res-occupancy-amend",
    offerId: "offer-occupancy-amend",
    unitId: UNIT_B,
    tenantId: OCCUPANCY_TENANT,
    parties: { primaryGuest: { id: GUEST, name: "Synthetic Guest" }, operator: { id: "operator-occupancy" }, distinctPayer: null },
    dates: { checkIn: "2026-08-20", checkOut: "2026-08-26", nights: 6 },
    occupants: [{ name: "Synthetic Guest" }],
    quote: {},
    totalAmountDueNowKobo: 0,
    policies: { cancellationPolicy: {}, guestConductRules: [] },
    paymentDetails: { paymentMethod: "fresh_card", pspReference: "psp-ref-occupancy" },
    contractVersion: 1,
  } as unknown as BookingContract;
  const unitProperties = { [UNIT_A]: PROPERTY, [UNIT_B]: PROPERTY };
  const earlierStay = (checkIn: string, checkOut: string) => ({
    requestId: "req-earlier",
    tenantId: OCCUPANCY_TENANT,
    primaryGuestId: GUEST,
    unitId: UNIT_A,
    checkIn,
    checkOut,
    status: "disclosed",
  });
  const request = (manager: BookingAmendmentManager, checkOut: string) => manager.requestAmendment(createPlatformCommandEnvelope({
    commandName: "booking_amendment.request",
    principal: guestPrincipal(GUEST),
    payload: { contractId, changes: { dates: { checkIn: "2026-08-20", checkOut } } },
  }), () => new Date("2026-08-10T10:00:00Z"));

  // 20 nights ending on the contract's check-in, then the amended stay of 12 nights makes 32 nights in total.
  const refusing = new BookingAmendmentManager(amendmentDependencies(contract, fixedOccupancyLedger({
    unitProperties,
    requests: [earlierStay("2026-07-31", "2026-08-20")],
  })));
  assert.throws(() => request(refusing, "2026-09-01"), (error: unknown) => error instanceof ContinuousOccupancyError && error.total === 32, "the amendment that makes 32 nights is refused");

  // Five nights ending on the check-in, then 12 amended nights make 17: the amendment proceeds.
  const allowing = new BookingAmendmentManager(amendmentDependencies(contract, fixedOccupancyLedger({
    unitProperties,
    requests: [earlierStay("2026-08-15", "2026-08-20")],
  })));
  assert.equal(request(allowing, "2026-09-01").status, "proposed", "the amendment that makes 17 nights is proposed");
});

test("assessContinuousOccupancy adds a chain end to end across Units of one Property, in both directions", () => {
  const candidate = stay("candidate", "2026-08-10", "2026-08-20", { unitId: UNIT_B });
  const before = stay("before", "2026-08-01", "2026-08-10");
  const after = stay("after", "2026-08-20", "2026-08-25", { unitId: UNIT_A });
  const assessment = assessContinuousOccupancy(candidate, [before, after], undefined);
  // 9 nights before, 10 candidate, 5 after: 24 in total.
  assert.equal(assessment.totalNights, 24);
  assert.equal(assessment.chain.length, 3);
  assert.equal(assessment.allowed, true);
});

test("assessContinuousOccupancy leaves out a stay of another Property and a stay that only overlaps", () => {
  const candidate = stay("candidate", "2026-08-10", "2026-08-20");
  const otherProperty = stay("other", "2026-08-01", "2026-08-10", { propertyId: OTHER_PROPERTY, unitId: UNIT_OTHER_PROPERTY });
  const overlapping = stay("overlap", "2026-08-15", "2026-08-25");
  const assessment = assessContinuousOccupancy(candidate, [otherProperty, overlapping], undefined);
  assert.equal(assessment.totalNights, 10);
  assert.deepEqual(assessment.chain.map((member) => member.ref), ["candidate"]);
});

test("assessContinuousOccupancy refuses an Extended Stay chain when no Extended Stay policy bounds it (fail closed)", () => {
  const candidate = stay("candidate", "2026-08-10", "2026-08-20");
  const extended = stay("extended", "2026-07-01", "2026-08-10", { stayType: "extended" });
  assert.throws(() => assessContinuousOccupancy(candidate, [extended], undefined), ContinuousOccupancyError);
});

test("the ledger refuses a counted stay whose Property cannot be resolved (fail closed, never skipped)", () => {
  const ledger = new ContinuousOccupancyLedger({
    store: null,
    bookingState: null,
    unitPropertyId: () => undefined,
    listBookingRequests: () => [{ requestId: "req-x", tenantId: OCCUPANCY_TENANT, primaryGuestId: GUEST, unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-21", status: "disclosed" }],
  });
  assert.throws(() => ledger.countedStays({ tenantId: OCCUPANCY_TENANT, primaryGuestId: GUEST, now: NOW }), ContinuousOccupancyError);
});

test("the refusal wording is the owner-confirmed short and extended chain sentences, with no guest identifier", () => {
  // Short chain: 9 nights before and 21 candidate nights make 30, which is over the 29-night Short Stay limit.
  const shortAssessment = assessContinuousOccupancy(stay("candidate", "2026-08-10", "2026-08-31"), [stay("before", "2026-08-01", "2026-08-10")], undefined);
  assert.equal(shortAssessment.allowed, false);
  assert.equal(continuousOccupancyRefusal(shortAssessment).message, "These dates join another stay of yours at this property, making 30 nights. A stay of 30 nights or more must be booked as one Extended Stay.");

  // Extended chain: 40 nights before and 40 candidate nights make 80, over a 70-night policy maximum.
  const extendedAssessment = assessContinuousOccupancy(
    stay("candidate", "2026-08-10", "2026-09-19", { stayType: "extended" }),
    [stay("before", "2026-07-01", "2026-08-10", { stayType: "extended" })],
    { ...EXTENDED_STAY_POLICY, maximumNights: 70 },
  );
  assert.equal(extendedAssessment.allowed, false);
  assert.equal(extendedAssessment.limit, 70);
  assert.equal(continuousOccupancyRefusal(extendedAssessment).message, "These dates join another stay of yours at this property, making 80 nights, more than the 70-night maximum.");
  assert.doesNotMatch(continuousOccupancyRefusal(extendedAssessment).message, /synthetic|guest-occupancy|ctr-|req-/);
});

test("Continuous Occupancy never reads another tenant's stays: a same-guest-id stay in tenant B is not counted for tenant A", () => {
  const repository = occupancyUnits();
  const stores = openOccupancyStores();
  try {
    const { manager } = occupancyManager({ repository, clock, stores });
    // Tenant B: the same Primary Guest id holds 20 nights at Unit A, ending on the candidate's check-in.
    confirmedStayFor(stores, manager, clock, { unitId: UNIT_A, tenantId: OTHER_TENANT, checkIn: "2026-08-01", checkOut: "2026-08-21" });
    // Tenant A sees none of it: 10 nights are allowed.
    const draftA = draftFor(manager, clock, { unitId: UNIT_B, checkIn: "2026-08-21", checkOut: "2026-08-31" });
    assert.equal(disclose(manager, clock, draftA.draftId).nights, 10, "tenant A's 10 nights are not joined to tenant B's stay");
    // The control: the same candidate in tenant B is refused by its own stay.
    assert.throws(() => draftFor(manager, clock, { unitId: UNIT_B, tenantId: OTHER_TENANT, checkIn: "2026-08-21", checkOut: "2026-08-31" }), (error: unknown) => {
      assert.ok(error instanceof ContinuousOccupancyError);
      return true;
    }, "the same guest id is counted in its own tenant");
    // The durable reader itself reads nothing without a tenant.
    assert.deepEqual(stores.store.findBookingRequestsForPrimaryGuest(GUEST, ""), [], "no tenant, no request is read");
  } finally {
    stores.close();
  }
});

test("A stay with no resolvable tenant is refused, not checked across tenants", () => {
  const repository = occupancyUnits();
  const stores = openOccupancyStores();
  const refusal = "These dates cannot be checked against your other stays at this property.";
  try {
    const { manager } = occupancyManager({ repository, clock, stores });
    confirmedStayFor(stores, manager, clock, { unitId: UNIT_A, checkIn: "2026-08-01", checkOut: "2026-08-21" });
    // A draft with no tenant (no principal) is refused, even for a 3-night stay that would otherwise fit.
    assert.throws(() => manager.createDraft({
      unitId: UNIT_B,
      primaryGuest: { id: GUEST, name: "Synthetic Guest", isGovernmentIdVerified: true },
      occupants: [{ name: "Synthetic Guest" }],
      selfBookingAttestation: { accepted: true, version: SELF_BOOKING_ATTESTATION_VERSION },
      checkIn: "2026-08-21",
      checkOut: "2026-08-24",
    }, { clock }), (error: unknown) => error instanceof ContinuousOccupancyError && error.message === refusal, "a draft with no tenant is refused");
    // A draft with no tenant and no counted stays is refused too: the tenant is never assumed.
    assert.throws(() => manager.createDraft({
      unitId: UNIT_B,
      primaryGuest: { id: OTHER_GUEST, name: "Other Synthetic Guest", isGovernmentIdVerified: true },
      occupants: [{ name: "Other Synthetic Guest" }],
      selfBookingAttestation: { accepted: true, version: SELF_BOOKING_ATTESTATION_VERSION },
      checkIn: "2026-08-21",
      checkOut: "2026-08-24",
    }, { clock }), (error: unknown) => error instanceof ContinuousOccupancyError && error.message === refusal, "a tenant-less draft is refused even with no stays to count");
    // An amendment whose contract has no tenant is refused by the same rule.
    const contract = {
      contractId: "ctr-no-tenant",
      reservationId: "res-no-tenant",
      offerId: "offer-no-tenant",
      unitId: UNIT_B,
      parties: { primaryGuest: { id: GUEST, name: "Synthetic Guest" }, operator: { id: "operator-occupancy" }, distinctPayer: null },
      dates: { checkIn: "2026-08-20", checkOut: "2026-08-26", nights: 6 },
      occupants: [{ name: "Synthetic Guest" }],
      quote: {},
      totalAmountDueNowKobo: 0,
      policies: { cancellationPolicy: {}, guestConductRules: [] },
      paymentDetails: { paymentMethod: "fresh_card", pspReference: "psp-ref-no-tenant" },
      contractVersion: 1,
    } as unknown as BookingContract;
    const amendments = new BookingAmendmentManager(amendmentDependencies(contract, fixedOccupancyLedger({ unitProperties: { [UNIT_B]: PROPERTY } })));
    assert.throws(() => amendments.requestAmendment(createPlatformCommandEnvelope({
      commandName: "booking_amendment.request",
      principal: guestPrincipal(GUEST),
      payload: { contractId: "ctr-no-tenant", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-22" } } },
    }), () => new Date("2026-08-10T10:00:00Z")), /Booking amendment is not authorized/, "an amendment whose contract has no tenant is refused before any date is read");
    // The guard itself, with no tenant resolved, refuses with the fail-closed sentence and reads no stay.
    assert.throws(() => assertContinuousOccupancy({
      ledger: fixedOccupancyLedger({ unitProperties: { [UNIT_B]: PROPERTY }, requests: [] }),
      tenantId: undefined,
      primaryGuestId: GUEST,
      unitId: UNIT_B,
      checkIn: "2026-08-21",
      checkOut: "2026-08-24",
      now: NOW,
      policy: undefined,
    }), (error: unknown) => error instanceof ContinuousOccupancyError && error.message === refusal, "the guard refuses an unresolved tenant");
  } finally {
    stores.close();
  }
});
