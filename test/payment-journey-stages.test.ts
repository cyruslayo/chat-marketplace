import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformCommandEnvelope, type CommandPrincipal } from "../packages/platform-core/src/index.js";
import {
  BankTransferPaymentManager,
  BOOKING_PAYMENT_STAGES,
  BOOKING_PAYMENT_STAGE_TRANSITIONS,
  CardPaymentManager,
  InMemoryBookingPaymentJourneyRepository,
  InMemoryBookingStateRepository,
  InMemorySecurityDepositAccountingRepository,
  LivePaymentAttemptRegistry,
} from "../domains/shortlet/src/index.js";
import {
  committedStageMoves,
  movesOutsideTable,
  recordingJourneys,
  stageGuest,
  stageOffer,
  stageSystem,
  type StageMove,
} from "./helpers/payment-journey-stages.js";
import { TEST_GUEST_CONTACTS, issueTransferAccount } from "./helpers/bank-transfer-provider.js";

// Issue 07 characterisation (ADR 0044, 0045, 0046, 0047): the stage sequence of the card stay-plus-deposit
// path and the bank-transfer path must not change when the stage writes are routed through one helper.

const cardOffer = stageOffer("offer-card-stage-07");
const bankGuest: CommandPrincipal = { id: "guest-bank-stage-07", role: "guest", tenantId: "tenant-stage-07" };
const bankOffer = stageOffer("offer-bank-stage-07", bankGuest);

const CARD_STAGE_SEQUENCE = ["stay_payment_active", "stay_settled", "deposit_payment_active", "confirmed"];
const CARD_STAGE_MOVES: StageMove[] = [
  { from: "ready", to: "stay_payment_active" },
  { from: "stay_payment_active", to: "stay_settled" },
  { from: "stay_settled", to: "deposit_payment_active" },
  { from: "deposit_payment_active", to: "both_settled" },
  { from: "both_settled", to: "confirmed" },
];
const BANK_STAGE_SEQUENCE = ["stay_payment_active", "stay_settled", "deposit_payment_active", "confirmed"];
const BANK_STAGE_MOVES: StageMove[] = [
  { from: "ready", to: "stay_payment_active" },
  { from: "stay_payment_active", to: "stay_settled" },
  { from: "stay_settled", to: "deposit_payment_active" },
  { from: "deposit_payment_active", to: "both_settled" },
  { from: "both_settled", to: "confirmed" },
];

test("Characterisation: the card stay-plus-deposit path produces the same sequence of stages as before", () => {
  const moves: StageMove[] = [];
  const journeys = recordingJourneys(new InMemoryBookingPaymentJourneyRepository(), moves);
  const accounting = new InMemorySecurityDepositAccountingRepository();
  const refs: number[] = [];
  let manager!: CardPaymentManager;
  manager = new CardPaymentManager({
    offerManager: { getOffer: () => cardOffer },
    journeyRepository: journeys,
    securityDepositAccounting: accounting,
    bookingState: new InMemoryBookingStateRepository(),
    securityDepositCapability: { getCapability: () => ({ capabilityVersion: "cap-stage-07", enabled: true, pspProviderId: "approved-psp", pspApproved: true, counselApproved: true, collectionModel: "separate_actual_charge", paymentMethod: "fresh_card" }) },
    liveAttempts: new LivePaymentAttemptRegistry(),
    calendar: { transitionPaymentPendingToConfirmedBooking: () => undefined },
    pspClient: {
      verifyTransaction(reference) {
        const session = manager.getCheckoutSessionByReference(reference)!;
        refs.push(session.amountKobo);
        return { verified: true, status: "success", amountKobo: session.amountKobo, currency: "NGN", pspReference: reference, payerId: stageGuest.id };
      },
    },
  });
  const stages: string[] = [];
  const observe = () => stages.push(manager.getPaymentJourney(cardOffer.offerId)!.stage);
  const initialize = (at: string) => manager.initializeCardCheckout(createPlatformCommandEnvelope({ commandName: "card_payment.initialize_checkout", principal: stageGuest, payload: { offerId: cardOffer.offerId } }), { clock: () => new Date(at) });
  const verify = (pspReference: string, at: string) => manager.verifyAndConfirmCardPayment(createPlatformCommandEnvelope({ commandName: "card_payment.verify_and_confirm", principal: stageSystem, payload: { offerId: cardOffer.offerId, pspReference } }), { clock: () => new Date(at) });

  const stay = initialize("2026-09-01T12:01:00Z");
  observe();
  const first = verify(stay.pspReference, "2026-09-01T12:02:00Z");
  observe();
  assert.equal((first as unknown as { outcome: string }).outcome, "deposit_required");
  const deposit = initialize("2026-09-01T12:03:00Z");
  observe();
  const result = verify(deposit.pspReference, "2026-09-01T12:04:00Z");
  observe();
  assert.equal((result as unknown as { outcome: string }).outcome, "confirmed");
  assert.deepEqual(refs, [18_234_567, 4_321_000]);
  assert.deepEqual(stages, CARD_STAGE_SEQUENCE);
  assert.deepEqual(moves, CARD_STAGE_MOVES);
});

test("Characterisation: the bank-transfer path produces the same sequence of stages as before", async () => {
  const moves: StageMove[] = [];
  const journeys = recordingJourneys(new InMemoryBookingPaymentJourneyRepository(), moves);
  const accounting = new InMemorySecurityDepositAccountingRepository();
  const amounts: number[] = [];
  let manager!: BankTransferPaymentManager;
  manager = new BankTransferPaymentManager({
    offerManager: { getOffer: () => bankOffer },
    journeyRepository: journeys,
    securityDepositAccounting: accounting,
    bookingState: new InMemoryBookingStateRepository(),
    securityDepositCapability: { getCapability: () => ({ capabilityVersion: "cap-bank-stage-07", enabled: true, pspProviderId: "approved-bank-psp", pspApproved: true, counselApproved: true, collectionModel: "separate_actual_charge", paymentMethod: "bank_transfer" }) },
    liveAttempts: new LivePaymentAttemptRegistry(),
    calendar: { transitionPaymentPendingToConfirmedBooking: () => undefined },
    guestContacts: TEST_GUEST_CONTACTS,
    providerClient: {
      createTransferAccount: issueTransferAccount,
      verifyTransfer(reference) {
        const session = manager.getSessionByReference(reference)!;
        amounts.push(session.amountKobo);
        return { verified: true, status: "success", amountKobo: session.amountKobo, currency: "NGN", pspReference: reference, payerId: bankGuest.id };
      },
    },
  });
  const stages: string[] = [];
  const observe = () => stages.push(manager.getPaymentJourney(bankOffer.offerId)!.stage);
  const initialize = (at: string) => manager.initializeBankTransfer(createPlatformCommandEnvelope({ commandName: "bank_transfer.initialize", principal: bankGuest, payload: { offerId: bankOffer.offerId } }), { clock: () => new Date(at) });
  const verify = (transferReference: string, at: string) => manager.verifyAndProcessTransfer(createPlatformCommandEnvelope({ commandName: "bank_transfer.verify_and_process", principal: stageSystem, payload: { transferReference } }), { clock: () => new Date(at) });

  const stay = await initialize("2026-09-01T12:01:00Z");
  observe();
  const first = verify(stay.transferReference, "2026-09-01T12:04:00Z");
  observe();
  assert.equal(first.outcome, "deposit_required");
  const deposit = await initialize("2026-09-01T12:03:00Z");
  observe();
  const result = verify(deposit.transferReference, "2026-09-01T12:04:00Z");
  observe();
  assert.equal(result.outcome, "confirmed");
  assert.deepEqual(amounts, [18_234_567, 4_321_000]);
  assert.deepEqual(stages, BANK_STAGE_SEQUENCE);
  assert.deepEqual(moves, BANK_STAGE_MOVES);
});

// Table-membership checks (issue 07, AC2 and AC3). The table is test-only input: production code never reads it.
// The AC2 test reads every move the two characterisation tests above committed, so it must stay after them.

test("Every stage move recorded across the card-payment and bank-transfer journeys is in BOOKING_PAYMENT_STAGE_TRANSITIONS", () => {
  assert.ok(committedStageMoves.length > 0, "the characterisation tests recorded stage moves");
  assert.deepEqual(movesOutsideTable(committedStageMoves), []);
});

test("A stage move that BOOKING_PAYMENT_STAGE_TRANSITIONS does not list is reported by the check", () => {
  assert.deepEqual(movesOutsideTable([{ from: "ready", to: "confirmed" }]), [{ from: "ready", to: "confirmed" }]);
});

test("The table lists all 13 stages", () => {
  assert.equal(BOOKING_PAYMENT_STAGES.length, 13);
  assert.deepEqual(Object.keys(BOOKING_PAYMENT_STAGE_TRANSITIONS).sort(), [...BOOKING_PAYMENT_STAGES].sort());
});

test("The never-written failed and expired stages have empty lists", () => {
  assert.deepEqual(BOOKING_PAYMENT_STAGE_TRANSITIONS.failed, []);
  assert.deepEqual(BOOKING_PAYMENT_STAGE_TRANSITIONS.expired, []);
});
