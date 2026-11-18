import { BOOKING_PAYMENT_STAGE_TRANSITIONS } from "../../domains/shortlet/src/index.js";
import { canTransition } from "../../packages/platform-core/src/state-transition.js";
import type {
  BookingPaymentJourney,
  BookingPaymentStage,
  BookingPaymentJourneyRepository,
  ConditionalBookingOffer,
} from "../../domains/shortlet/src/index.js";
import type { CommandPrincipal } from "../../packages/platform-core/src/index.js";

// Shared fixtures for the BookingPaymentJourney stage tests (issue 07, ADR 0044, 0045, 0046, 0047).

export interface StageMove {
  readonly from: BookingPaymentStage;
  readonly to: BookingPaymentStage;
}

/** Every move any recordingJourneys spy has committed in this test process (read by the table-membership test). */
export const committedStageMoves: StageMove[] = [];

/** Test-only spy over the journey repository: records every stage move that an update actually commits. */
export function recordingJourneys(
  inner: BookingPaymentJourneyRepository,
  moves: StageMove[],
): BookingPaymentJourneyRepository {
  return {
    findByOfferId: (offerId) => inner.findByOfferId(offerId),
    createIfAbsent: (input) => inner.createIfAbsent(input),
    update(offerId, expectedJourneyVersion, mutation) {
      let from: BookingPaymentStage | undefined;
      const committed = inner.update(
        offerId,
        expectedJourneyVersion,
        (current: BookingPaymentJourney) => {
          from = current.stage;
          return mutation(current);
        },
      );
      if (from !== undefined) {
        const move = { from, to: committed.stage };
        moves.push(move);
        committedStageMoves.push(move);
      }
      return committed;
    },
  };
}

export const stageGuest: CommandPrincipal = {
  id: "guest-stage-07",
  role: "guest",
  tenantId: "tenant-stage-07",
};
export const stageSystem: CommandPrincipal = {
  id: "system-stage-07",
  role: "system",
  tenantId: "tenant-stage-07",
};

/** An accepted offer with a refundable Security Deposit (the card and bank-transfer deposit paths need one). */
export function stageOffer(
  offerId: string,
  guest: CommandPrincipal = stageGuest,
): ConditionalBookingOffer {
  return {
    offerId,
    offerVersion: 1,
    requestId: `request-${offerId}`,
    inventoryCommitmentId: `commit-${offerId}`,
    unitId: `unit-${offerId}`,
    tenantId: guest.tenantId,
    parties: {
      primaryGuest: { id: guest.id, name: "Guest" },
      operator: { id: `operator-${offerId}`, name: "Operator" },
      distinctPayer: null,
    },
    unit: { id: `unit-${offerId}`, title: "Unit", propertyId: `property-${offerId}`, location: {} },
    dates: { checkIn: "2026-09-01", checkOut: "2026-09-03", nights: 2 },
    occupants: [{ name: "Guest" }],
    quote: { allInStayTotalKobo: 18_234_567, currency: "NGN" },
    refundableSecurityDepositKobo: 4_321_000,
    securityDeposit: {
      policyVersion: "security-deposit/adr-0063-launch-v1",
      currency: "NGN",
      accommodationSubtotalKobo: 18_234_567,
      bedroomBand: "two_bedroom",
      percentageCapKobo: 4_558_641,
      unitSizeCapKobo: 15_000_000,
      unitConfiguredDepositKobo: 4_321_000,
      amountKobo: 4_321_000,
      collectionRequired: true,
    },
    totalAmountDueNowKobo: 22_555_567,
    policies: { cancellationPolicy: {}, guestConductRules: [] },
    disclosures: [],
    paymentWindow: { durationMinutes: 20, expiresAt: "2099-09-01T12:20:00.000Z" },
    status: "accepted",
    issuedAt: "2026-09-01T12:00:00.000Z",
    confirmationToken: "token",
    tokenUsed: true,
    aggregateVersions: {
      offerVersion: 1,
      pricingVersion: "p1",
      quoteVersion: "q1",
      cancellationPolicyVersion: "c1",
      managementAuthorityVersion: "m1",
      inspectionVersion: "i1",
    },
  };
}

/** Moves that the allowed-from table does not list. Empty when every move is in BOOKING_PAYMENT_STAGE_TRANSITIONS. */
export function movesOutsideTable(moves: readonly StageMove[]): StageMove[] {
  return moves.filter(
    (move) =>
      !canTransition(
        BOOKING_PAYMENT_STAGE_TRANSITIONS,
        move.from,
        move.to,
      ),
  );
}
