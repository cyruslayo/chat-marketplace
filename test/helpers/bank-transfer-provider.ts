import type { BankTransferAccountRequest, GuestContactSource, ProviderTransferAccount } from "../../domains/shortlet/src/index.js";

/** The bank a test provider names; only ever shown because the provider said so (ADR 0047). */
export const TEST_TRANSFER_BANK = "Test Provider Bank";
/** The account number a test provider issues. */
export const TEST_TRANSFER_ACCOUNT = "0123456789";
/** The payer email the Guest side holds, for the provider request. */
export const TEST_TRANSFER_EMAIL = "payer@example.test";

/** Guest contact state with a phone and an email, as payment continuation requires. */
export const TEST_GUEST_CONTACTS: GuestContactSource = {
  find: (guestId, tenantId) => ({ guestId, tenantId, phoneNumber: "+2348012345678", contactEmail: TEST_TRANSFER_EMAIL, revision: 1 }),
};

/** A provider that issues an account for exactly what was asked: this reference, expiring at the requested deadline. */
export async function issueTransferAccount(request: BankTransferAccountRequest): Promise<ProviderTransferAccount> {
  return { bankName: TEST_TRANSFER_BANK, accountNumber: TEST_TRANSFER_ACCOUNT, reference: request.reference, expiresAt: request.expiresAt };
}
