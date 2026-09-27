import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatformCommandEnvelope, InMemoryAuditLog, type CommandPrincipal } from "../packages/platform-core/src/index.js";
import { BankTransferPaymentManager, BankTransferProviderError, InMemoryBookingPaymentJourneyRepository, InMemoryBookingStateRepository, LivePaymentAttemptRegistry, type BankTransferAccountRequest, type ConditionalBookingOffer, type ProviderTransferAccount } from "../domains/shortlet/src/index.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LOCAL_TRANSFER_BANK_NAME } from "../apps/local-guest/src/local-bank-transfer-provider.js";
import { TEST_GUEST_CONTACTS, TEST_TRANSFER_EMAIL } from "./helpers/bank-transfer-provider.js";

// P1 — the provider issues the transfer account (.scratch/guest-payments/issues/01-provider-issued-transfer-account.md).

const NOW = new Date("2026-09-01T12:02:00.000Z");
const DEADLINE = "2026-09-01T12:20:00.000Z";
const guest: CommandPrincipal = { id: "guest-p1", role: "guest", tenantId: "tenant-p1" };
const offer: ConditionalBookingOffer = { offerId: "offer-p1", offerVersion: 1, requestId: "request-p1", inventoryCommitmentId: "commit-p1", unitId: "unit-p1", tenantId: guest.tenantId, parties: { primaryGuest: { id: guest.id!, name: "Guest" }, operator: { id: "operator-p1", name: "Operator" }, distinctPayer: null }, unit: { id: "unit-p1", title: "Unit", propertyId: "property-p1", location: {} }, dates: { checkIn: "2026-09-10", checkOut: "2026-09-12", nights: 2 }, occupants: [{ name: "Guest" }], quote: { allInStayTotalKobo: 25_123_400, currency: "NGN" }, refundableSecurityDepositKobo: 0, totalAmountDueNowKobo: 25_123_400, policies: { cancellationPolicy: {}, guestConductRules: [] }, disclosures: [], paymentWindow: { durationMinutes: 20, expiresAt: DEADLINE }, status: "accepted", issuedAt: "2026-09-01T12:00:00.000Z", confirmationToken: "token", tokenUsed: true, aggregateVersions: { offerVersion: 1, pricingVersion: "p", quoteVersion: "q", cancellationPolicyVersion: "c", managementAuthorityVersion: "m", inspectionVersion: "i" } };

/** A manager over a scripted provider that records every account request. */
function setup(answer: (request: BankTransferAccountRequest) => Promise<ProviderTransferAccount> = async (request) => ({ bankName: "Wema Bank", accountNumber: "9988776655", reference: request.reference, expiresAt: request.expiresAt })) {
  const requests: BankTransferAccountRequest[] = [];
  const attempts = new LivePaymentAttemptRegistry();
  const journeys = new InMemoryBookingPaymentJourneyRepository();
  const audit = new InMemoryAuditLog();
  const manager = new BankTransferPaymentManager({
    offerManager: { getOffer: () => offer },
    guestContacts: TEST_GUEST_CONTACTS,
    providerClient: { createTransferAccount: (request) => { requests.push(request); return answer(request); }, verifyTransfer: () => { throw new Error("not used"); } },
    liveAttempts: attempts,
    journeyRepository: journeys,
    bookingState: new InMemoryBookingStateRepository(),
    audit,
  });
  const start = () => manager.initializeBankTransfer(createPlatformCommandEnvelope({ commandName: "bank_transfer.initialize", principal: guest, payload: { offerId: offer.offerId } }), { clock: () => NOW });
  return { manager, requests, attempts, journeys, audit, start };
}

/** Nothing was recorded: no session, no attempt, no journey, no audit, no account. */
function assertNothingRecorded(s: ReturnType<typeof setup>) {
  assert.equal(s.manager.getSession(offer.offerId), undefined, "no session");
  assert.equal(s.attempts.current(offer.offerId, NOW), undefined, "no live attempt");
  assert.equal(s.journeys.findByOfferId(offer.offerId), null, "no payment journey");
  assert.equal(s.audit.entries().filter((entry) => entry.type === "bank_transfer.initialized").length, 0, "no audit");
}

test("AC1 — Starting a bank transfer returns the bank name, account number and expiry supplied by the provider for that booking's reference and exact amount, and the domain no longer creates account details", async () => {
  const s = setup(async (request) => ({ bankName: "Wema Bank", accountNumber: "9988776655", reference: request.reference, expiresAt: "2026-09-01T12:19:00.000Z" }));
  const session = await s.start();
  assert.equal(s.requests.length, 1);
  const [request] = s.requests;
  assert.deepEqual(request, { reference: session.transferReference, amountKobo: 25_123_400, currency: "NGN", expiresAt: DEADLINE, email: TEST_TRANSFER_EMAIL });
  assert.equal(session.bankName, "Wema Bank");
  assert.equal(session.accountNumber, "9988776655");
  assert.equal(session.expiresAt, "2026-09-01T12:19:00.000Z", "the provider's expiry, not the platform's");
  assert.equal(session.amountKobo, 25_123_400);
  assert.equal(s.attempts.current(offer.offerId, NOW)?.method, "bank_transfer");
  // ADR 0075: the account number never reaches the audit.
  assert.ok(!JSON.stringify(s.audit.entries()).includes("9988776655"));

  // LocalGuestEnvironment composes the app over the deterministic local provider; the account is the provider's.
  const dir = mkdtempSync(join(tmpdir(), "p1-guest-"));
  const env = new LocalGuestEnvironment({ databasePath: join(dir, "guest.sqlite"), initialGuestPhoneNumber: "+2348012345678", initialGuestContactEmail: "guest@example.test" });
  try {
    assert.ok(env.bankTransferApp, "bank transfer app is composed locally");
    const draft = env.bookingRequestApp.createDraft({ unitId: "unit-lagos-ikoyi-001", primaryGuest: { id: env.config.guestId, name: env.config.guestName }, occupants: env.demoOccupants(2), selfBookingAttestation: env.selfBookingAttestation(), checkIn: "2026-09-10", checkOut: "2026-09-13" }, env.guestPrincipal());
    const request = env.bookingRequestApp.disclose(draft.draftId, env.guestPrincipal());
    const { offerId } = env.simulateOperatorAcceptance(request.requestId);
    const localOffer = env.conditionalOfferApp.manager.getOffer(offerId);
    env.conditionalOfferApp.accept({ offerId, confirmationToken: localOffer.confirmationToken, expectedVersion: localOffer.offerVersion, principal: env.guestPrincipal() });
    const local = await env.bankTransferApp.initializeTransfer(offerId, env.guestPrincipal());
    assert.equal(local.bankName, LOCAL_TRANSFER_BANK_NAME);
    assert.match(local.accountNumber, /^\d{10}$/);
    assert.equal(local.expiresAt, localOffer.paymentWindow.expiresAt);
    assert.equal(env.bankTransferApp.getArtifact(offerId, env.guestPrincipal()).facts.accountNumber, local.accountNumber);
  } finally { env.close(); rmSync(dir, { recursive: true, force: true }); }

  // Production has no transfer provider until the Paystack adapter (P2): nothing can invent an account.
  const productionDir = mkdtempSync(join(tmpdir(), "p1-prod-"));
  try {
    const production = new LocalGuestEnvironment({ databasePath: join(productionDir, "guest.sqlite"), deterministicPsp: false });
    try { assert.equal(production.bankTransferApp, null); } finally { production.close(); }
  } finally { rmSync(productionDir, { recursive: true, force: true }); }
});

test("AC2 — The provider expiry must not be later than the Payment Window deadline; a later expiry, or a provider error, fails closed and no attempt is recorded", async () => {
  const later = setup(async (request) => ({ bankName: "Wema Bank", accountNumber: "9988776655", reference: request.reference, expiresAt: "2026-09-01T12:20:00.001Z" }));
  await assert.rejects(later.start(), (error: unknown) => error instanceof BankTransferProviderError && /after the Payment Window deadline/.test(error.message));
  assertNothingRecorded(later);

  const failing = setup(async () => { throw new Error("provider down: secret-key-123"); });
  await assert.rejects(failing.start(), (error: unknown) => error instanceof BankTransferProviderError && !error.message.includes("secret-key-123"));
  assertNothingRecorded(failing);

  // An answer for another reference, a missing account number, or an unreadable expiry is not this booking's account.
  for (const answer of [
    async (request: BankTransferAccountRequest) => ({ bankName: "Wema Bank", accountNumber: "9988776655", reference: `${request.reference}-other`, expiresAt: request.expiresAt }),
    async (request: BankTransferAccountRequest) => ({ bankName: "Wema Bank", accountNumber: "", reference: request.reference, expiresAt: request.expiresAt }),
    async (request: BankTransferAccountRequest) => ({ bankName: "", accountNumber: "9988776655", reference: request.reference, expiresAt: request.expiresAt }),
    async (request: BankTransferAccountRequest) => ({ bankName: "Wema Bank", accountNumber: "9988776655", reference: request.reference, expiresAt: "not a time" }),
  ]) {
    const s = setup(answer);
    await assert.rejects(s.start(), BankTransferProviderError);
    assertNothingRecorded(s);
  }

  // Without an email on file the provider is never asked.
  const noEmail = new BankTransferPaymentManager({ offerManager: { getOffer: () => offer }, guestContacts: { find: () => null }, providerClient: { createTransferAccount: async () => { throw new Error("must not be called"); }, verifyTransfer: () => { throw new Error("not used"); } } });
  await assert.rejects(noEmail.initializeBankTransfer(createPlatformCommandEnvelope({ commandName: "bank_transfer.initialize", principal: guest, payload: { offerId: offer.offerId } }), { clock: () => NOW }), /email address is required/);

  // After a failure the Guest can start again cleanly.
  let calls = 0;
  const retry = setup(async (request) => { calls += 1; if (calls === 1) throw new Error("timeout"); return { bankName: "Wema Bank", accountNumber: "9988776655", reference: request.reference, expiresAt: request.expiresAt }; });
  await assert.rejects(retry.start(), BankTransferProviderError);
  assert.equal((await retry.start()).accountNumber, "9988776655");
});

test("AC3 — Starting again while the transfer is still payable returns the same account and never a second one (ADR 0046)", async () => {
  const s = setup();
  const first = await s.start();
  const again = await s.start();
  assert.equal(again.transferReference, first.transferReference);
  assert.equal(again.accountNumber, first.accountNumber);
  assert.equal(s.requests.length, 1, "the provider was asked once");

  // Two starts at the same moment share one provider request.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const concurrent = setup(async (request) => { await gate; return { bankName: "Wema Bank", accountNumber: "9988776655", reference: request.reference, expiresAt: request.expiresAt }; });
  const both = Promise.all([concurrent.start(), concurrent.start()]);
  release();
  const [a, b] = await both;
  assert.equal(a.transferReference, b.transferReference);
  assert.equal(concurrent.requests.length, 1);

  // Another method's live attempt keeps the slot: no transfer account is requested.
  const held = setup();
  held.attempts.acquire({ offerId: offer.offerId, method: "fresh_card", purpose: "stay", attemptId: "card-attempt", startedAt: NOW.toISOString(), expiresAt: DEADLINE });
  await assert.rejects(held.start(), /live fresh_card stay payment attempt already owns this offer/);
  assert.equal(held.requests.length, 0);
});
