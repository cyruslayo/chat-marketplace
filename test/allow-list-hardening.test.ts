import test from "node:test";
import assert from "node:assert/strict";
import { BookingAmendmentManager, type BookingAmendmentDependencies, type BookingContract } from "../domains/shortlet/src/index.js";
import { createPlatformCommandEnvelope, type CommandPrincipal } from "../packages/platform-core/src/index.js";
import { GenerativeSurfaceManager } from "../packages/platform-core/src/surface.js";
import { fixedOccupancyLedger } from "./helpers/continuous-occupancy-fixture.js";
import { at, bankSetup, providerSuccess } from "./helpers/bank-transfer-session-fixture.js";

// Issue 17 (state-machines PRD, Track C): allow-list hardening for three latent deny-lists.
// ADR 0044 (Payment Window and grace), ADR 0045 (refund every late payment), ADR 0047 (expiring bank transfers),
// ADR 0060 (versioned booking amendments), ADR 0074 (fail-closed surface lifecycle).

// ---- 1. Bank transfer resolveExpiry (ADR 0044, 0045, 0047) ------------------------------------------------------

test("AC1: resolveExpiry on a completed bank-transfer session leaves it completed, releases no inventory and writes no bank_transfer.expired audit", async () => {
  const audited: Record<string, unknown>[] = [];
  const s = bankSetup("bank-completed-expiry", { audit: { record: (entry) => audited.push(entry) } });
  const session = await s.start();
  s.setResult(providerSuccess(session.transferReference, s.offer.totalAmountDueNowKobo));
  assert.equal(s.verify(session.transferReference, 1).outcome, "confirmed");
  assert.equal(s.manager.getSession(s.offer.offerId)?.status, "completed");

  const after = s.manager.resolveExpiry(s.offer.offerId, s.server, { clock: () => at(31) });

  assert.equal(after.status, "completed");
  assert.equal(s.manager.getSession(s.offer.offerId)?.status, "completed");
  assert.equal(audited.filter((entry) => entry.type === "bank_transfer.expired").length, 0);
  const availability = s.calendar.getAuthoritativeAvailability({ unitId: s.offer.unitId, checkIn: s.offer.dates.checkIn, checkOut: s.offer.dates.checkOut, clock: () => at(31) });
  assert.equal(availability.isAvailable, false, "the confirmed booking must keep its dates");
});

test("AC2: resolveExpiry on initiated or processing_in_grace past grace expires exactly as before, and on expired or refunded returns the session unchanged", async () => {
  const grace = bankSetup("bank-ac2-grace");
  const graceSession = await grace.start();
  grace.setResult({ ...providerSuccess(graceSession.transferReference, grace.offer.totalAmountDueNowKobo), status: "pending", processingStartedAt: at(19).toISOString() });
  assert.equal(grace.verify(graceSession.transferReference, 20).outcome, "processing_in_grace");
  const expiredFromGrace = grace.manager.resolveExpiry(grace.offer.offerId, grace.server, { clock: () => at(30) });
  assert.equal(expiredFromGrace.status, "expired");
  assert.equal(grace.manager.getSession(grace.offer.offerId)?.status, "expired");

  const refunded = bankSetup("bank-ac2-refunded");
  const refundedSession = await refunded.start();
  refunded.setResult(providerSuccess(refundedSession.transferReference, refunded.offer.totalAmountDueNowKobo));
  assert.equal(refunded.verify(refundedSession.transferReference, 21).outcome, "late_payment_refunded");
  const unchanged = refunded.manager.resolveExpiry(refunded.offer.offerId, refunded.server, { clock: () => at(31) });
  assert.equal(unchanged.status, "refunded");
  assert.equal(refunded.manager.getSession(refunded.offer.offerId)?.status, "refunded");
});

// ---- 2. Booking amendment commit guard (ADR 0060) ---------------------------------------------------------------

function contract(): BookingContract { return { contractId: "ctr-amend-1", reservationId: "res-amend-1", offerId: "off-1", unitId: "unit-1", tenantId: "tenant-1", parties: { primaryGuest: { id: "guest-1", name: "Ada" }, operator: { id: "op-1" }, distinctPayer: null }, dates: { checkIn: "2026-08-20", checkOut: "2026-08-25", nights: 5 }, occupants: [{ name: "Ada" }], quote: { allInStayTotalKobo: 50000, refundableSecurityDepositKobo: 10000, currency: "NGN", cancellation: "captured" }, totalAmountDueNowKobo: 50000, policies: { cancellationPolicy: { version: "v1" }, guestConductRules: ["No smoking"] }, paymentDetails: { paymentMethod: "fresh_card", pspReference: "original", amountKobo: 50000, currency: "NGN", paidAt: "2026-08-01T00:00:00Z", cardMetadata: { brand: "Visa", last4: "1234" } }, createdAt: "2026-08-01T00:00:00Z", contractVersion: 1, checkout: { time: "11:00", timezone: "Africa/Lagos", source: "contractual" }, financialSummary: { originalBookingTotalKobo: 50000, currentContractTotalKobo: 50000, currency: "NGN", amendmentAdjustments: [] } }; }

// Minimal amendment fixture: a six-night stay adds a collection, a four-night stay has no financial effect.
function amendmentSetup() {
  let current = contract();
  const deps: BookingAmendmentDependencies = {
    continuousOccupancy: fixedOccupancyLedger({ unitProperties: { "unit-1": "property-1" } }),
    contractRepository: {
      getContract: () => current,
      mutateContract: (_id, expected, mutation) => {
        if (current.contractVersion !== expected) throw new Error("STALE_ACTION");
        current = mutation(current);
        return current;
      },
    },
    calendar: { getAuthoritativeAvailability: () => ({ isAvailable: true, version: "a1" }), hasSameDayCheckInOnDate: () => false },
    inspectionRepository: { isPassedAndValidThrough: () => ({ valid: true, version: "i1" }) },
    authorityRepository: { isValidThrough: () => ({ valid: true, version: "m1" }) },
    quoteProvider: {
      quote: ({ resultingDates }) => {
        const extended = resultingDates.nights === 6;
        return {
          quoteId: "quote-current",
          quoteVersion: "2",
          currency: "NGN" as const,
          revisedAllInStayTotalKobo: extended ? 60000 : 50000,
          financialAdjustment: extended
            ? { type: "additional_collection" as const, amountKobo: 10000, currency: "NGN" as const }
            : { type: "none" as const, amountKobo: 0, currency: "NGN" as const },
        };
      },
    },
    settlementProvider: {
      settle: ({ amendmentId, contractId, adjustment, quote }) => ({
        settlementId: `settlement-${amendmentId}`,
        amendmentId,
        contractId,
        type: adjustment.type,
        amountKobo: adjustment.amountKobo,
        currency: "NGN" as const,
        status: "settled" as const,
        quoteId: quote.quoteId,
        quoteVersion: quote.quoteVersion,
      }),
    },
  };
  const guest: CommandPrincipal = { id: "guest-1", role: "guest", tenantId: "tenant-1" };
  const system: CommandPrincipal = { id: "settlement-service", role: "system", tenantId: "tenant-1" };
  const command = <T>(name: string, principal: CommandPrincipal, payload: T) => createPlatformCommandEnvelope({ commandName: name, principal, payload });
  const requestClock = () => new Date("2026-08-10T10:00:00Z");
  return {
    manager: new BookingAmendmentManager(deps),
    guest,
    system,
    command,
    requestClock,
    commit: (amendmentId: string) => command("booking_amendment.commit", system, { amendmentId }),
    get: () => current,
  };
}

test("AC3: commitAmendment on an expired amendment throws STALE_ACTION, and accepted and awaiting_financial_settlement amendments still commit", () => {
  // Expired: an extension whose completion deadline (24 Aug 20:00 WAT) has passed when the commit runs.
  const expired = amendmentSetup();
  const extension = expired.manager.requestAmendment(expired.command("booking_amendment.request", expired.guest, { contractId: "ctr-amend-1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } }), expired.requestClock);
  expired.manager.acceptAmendment(extension.amendmentId, expired.guest, expired.requestClock);
  const lateClock = () => new Date("2026-08-26T10:00:00Z");
  assert.throws(() => expired.manager.commitAmendment(expired.commit(extension.amendmentId), lateClock), /Amendment completion deadline has passed/);
  assert.throws(() => expired.manager.commitAmendment(expired.commit(extension.amendmentId), lateClock), /STALE_ACTION/);
  assert.equal(expired.get().contractVersion, 1);

  // Accepted: a shortening with no financial adjustment commits.
  const accepted = amendmentSetup();
  const shorter = accepted.manager.requestAmendment(accepted.command("booking_amendment.request", accepted.guest, { contractId: "ctr-amend-1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-24" } } }), accepted.requestClock);
  accepted.manager.acceptAmendment(shorter.amendmentId, accepted.guest, accepted.requestClock);
  assert.equal(accepted.manager.commitAmendment(accepted.commit(shorter.amendmentId), accepted.requestClock).newVersion, 2);

  // Awaiting financial settlement: an extension with a settled collection commits.
  const awaiting = amendmentSetup();
  const paid = awaiting.manager.requestAmendment(awaiting.command("booking_amendment.request", awaiting.guest, { contractId: "ctr-amend-1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-26" } } }), awaiting.requestClock);
  awaiting.manager.acceptAmendment(paid.amendmentId, awaiting.guest, awaiting.requestClock);
  assert.equal(awaiting.manager.commitAmendment(awaiting.commit(paid.amendmentId), awaiting.requestClock).newVersion, 2);
});

test("AC3: commitAmendment on a proposed amendment still throws Explicit guest acceptance is required", () => {
  const s = amendmentSetup();
  const proposed = s.manager.requestAmendment(s.command("booking_amendment.request", s.guest, { contractId: "ctr-amend-1", changes: { dates: { checkIn: "2026-08-20", checkOut: "2026-08-24" } } }), s.requestClock);
  assert.throws(() => s.manager.commitAmendment(s.commit(proposed.amendmentId), s.requestClock), /Explicit guest acceptance is required/);
  assert.equal(s.get().contractVersion, 1);
});

// ---- 3. Surface lifecycle from-state guard (ADR 0074) ----------------------------------------------------------

test("AC4: a deleted surface stays deleted after expireSurface, supersedeSurface and updateSurfaceProjection", () => {
  const manager = new GenerativeSurfaceManager();
  const surface = manager.createSurface({ catalogue: "discovery/v1" });
  manager.deleteSurface(surface.surfaceId);

  manager.expireSurface(surface.surfaceId);
  assert.equal(manager.getSurface(surface.surfaceId).status, "deleted");
  manager.supersedeSurface(surface.surfaceId);
  assert.equal(manager.getSurface(surface.surfaceId).status, "deleted");
  manager.updateSurfaceProjection(surface.surfaceId, { projectionVersion: 0, facts: { priceKobo: 1 } });
  assert.equal(manager.getSurface(surface.surfaceId).status, "deleted");
});

test("AC4: an active surface still moves to expired, superseded and deleted as before", () => {
  const manager = new GenerativeSurfaceManager();
  const expiring = manager.createSurface({ catalogue: "discovery/v1" });
  manager.expireSurface(expiring.surfaceId);
  assert.equal(manager.getSurface(expiring.surfaceId).status, "expired");

  const superseding = manager.createSurface({ catalogue: "discovery/v1" });
  manager.supersedeSurface(superseding.surfaceId);
  assert.equal(manager.getSurface(superseding.surfaceId).status, "superseded");

  const deleting = manager.createSurface({ catalogue: "discovery/v1" });
  manager.deleteSurface(deleting.surfaceId);
  assert.equal(manager.getSurface(deleting.surfaceId).status, "deleted");
});
