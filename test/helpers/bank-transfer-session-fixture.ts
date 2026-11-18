import type { ConditionalBookingOffer } from "../../domains/shortlet/src/conditional-offer.js";
import { BankTransferPaymentManager, type BankTransferProviderResult } from "../../domains/shortlet/src/bank-transfer.js";
import type { PlatformCommandEnvelope, CommandPrincipal } from "../../packages/platform-core/src/index.js";
import { createTestAvailabilityCalendar } from "./availability-calendar.js";
import { TEST_GUEST_CONTACTS, issueTransferAccount } from "./bank-transfer-provider.js";

// Shared fixture for the bank transfer session tests (issue 17 and issue 06). Extracted from
// test/payment-session-transitions.test.ts so the allow-list hardening tests reuse the same setup.
export const T0 = new Date("2026-07-22T10:00:00Z");
export const MINUTE = 60_000;
export const at = (minutes: number): Date => new Date(T0.getTime() + minutes * MINUTE);

export function paymentOffer(overrides: { readonly offerId: string; readonly guestId: string; readonly tenantId: string }): ConditionalBookingOffer {
  return {
    offerId: overrides.offerId,
    offerVersion: 1,
    requestId: "request",
    inventoryCommitmentId: `commit-${overrides.offerId}`,
    unitId: "unit-06",
    tenantId: overrides.tenantId,
    parties: { primaryGuest: { id: overrides.guestId, name: "Guest Six" }, operator: { id: "operator", name: "Operator" }, distinctPayer: null },
    unit: { id: "unit-06", title: "Unit Six", propertyId: "property", location: { city: "Lagos" } },
    dates: { checkIn: "2026-08-01", checkOut: "2026-08-05", nights: 4 },
    occupants: [{ name: "Guest Six" }],
    quote: { breakdown: { accommodationNetKobo: 8_000_000, platformCommissionKobo: 2_000_000 } },
    totalAmountDueNowKobo: 10_000,
    refundableSecurityDepositKobo: 0,
    policies: { cancellationPolicy: {}, guestConductRules: [] },
    disclosures: [],
    paymentWindow: { durationMinutes: 20, expiresAt: new Date(T0.getTime() + 20 * MINUTE).toISOString() },
    status: "accepted",
    issuedAt: T0.toISOString(),
    acceptedAt: T0.toISOString(),
    confirmationToken: "token",
    tokenUsed: true,
    aggregateVersions: { offerVersion: 1, pricingVersion: "v1", quoteVersion: "v1", cancellationPolicyVersion: "v1", managementAuthorityVersion: "v1", inspectionVersion: "v1" },
  };
}

export function envelope<T>(commandName: string, payload: T, principal: CommandPrincipal): PlatformCommandEnvelope<T> {
  return { commandId: `${commandName}-${Math.random()}`, commandName, principal, payload, timestamp: T0.toISOString() };
}

export function bankSetup(id: string, options: { readonly audit?: { record(entry: Record<string, unknown>): void } } = {}) {
  const offer = paymentOffer({ offerId: id, guestId: "guest-11", tenantId: "tenant-11" });
  const calendar = createTestAvailabilityCalendar();
  const block = calendar.createBookingRequestBlock({ unitId: offer.unitId, holderId: offer.parties.primaryGuest.id, start: offer.dates.checkIn, end: offer.dates.checkOut, clock: () => T0 });
  calendar.transitionBookingRequestBlockToPaymentPending({ commitmentId: block.commitmentId, unitId: offer.unitId, start: offer.dates.checkIn, end: offer.dates.checkOut, clock: () => T0 });
  const authoritative = { ...offer, inventoryCommitmentId: block.commitmentId };
  let providerResult: BankTransferProviderResult | undefined;
  const manager = new BankTransferPaymentManager({
    offerManager: { getOffer: () => authoritative },
    calendar,
    providerClient: {
      createTransferAccount: issueTransferAccount,
      verifyTransfer: () => {
        if (!providerResult) throw new Error("fake provider result not configured");
        return providerResult;
      },
    },
    guestContacts: TEST_GUEST_CONTACTS,
    audit: options.audit,
  });
  const payer: CommandPrincipal = { id: "guest-11", role: "guest", tenantId: "tenant-11" };
  const server: CommandPrincipal = { id: "payment-worker", role: "system", tenantId: "tenant-11" };
  return {
    manager,
    calendar,
    offer: authoritative,
    payer,
    server,
    start: async () => manager.initializeBankTransfer(envelope("bank_transfer.initialize", { offerId: id }, payer), { clock: () => T0 }),
    setResult: (result: BankTransferProviderResult) => {
      providerResult = result;
    },
    verify: (reference: string, minutes: number) =>
      manager.verifyAndProcessTransfer({ ...envelope("bank_transfer.verify_and_process", { transferReference: reference }, server), principal: server }, { clock: () => at(minutes) }),
  };
}

export function providerSuccess(reference: string, amountKobo: number, payerId = "guest-11"): BankTransferProviderResult {
  return { verified: true, status: "success", amountKobo, currency: "NGN", pspReference: reference, payerId };
}
