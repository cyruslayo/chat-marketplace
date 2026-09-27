import { createHash } from "node:crypto";
import type { BankTransferAccountRequest, BankTransferProviderClient, BankTransferProviderResult, ProviderTransferAccount } from "../../../domains/shortlet/src/index.js";

/**
 * Local deterministic transfer provider for tests and `guest:local` only, like the card path's local payment.
 * It plays the provider's part: it issues the account for the exact reference and amount asked, expiring at the
 * requested deadline, and reports the issued amount back on verification. It moves no money and is never composed
 * in production (the Paystack adapter replaces it, P2).
 */
export const LOCAL_TRANSFER_BANK_NAME = "Local Demo Bank";

export class LocalBankTransferProvider implements BankTransferProviderClient {
  readonly #issued = new Map<string, { readonly amountKobo: number; readonly expiresAt: string }>();
  readonly #lookup: (reference: string) => { readonly amountKobo: number; readonly payerId: string } | undefined;

  /**
   * `lookup` reads the issued transfer (amount and authoritative payer) from the durable session, as a real
   * provider would know its own account after a restart and attribute the sender.
   */
  constructor(options: { readonly lookup: (reference: string) => { readonly amountKobo: number; readonly payerId: string } | undefined }) {
    this.#lookup = options.lookup;
  }

  async createTransferAccount(request: BankTransferAccountRequest): Promise<ProviderTransferAccount> {
    const existing = this.#issued.get(request.reference);
    if (existing && (existing.amountKobo !== request.amountKobo || existing.expiresAt !== request.expiresAt)) throw new Error("Reference already issued with different terms");
    this.#issued.set(request.reference, { amountKobo: request.amountKobo, expiresAt: request.expiresAt });
    // A stable ten-digit number per reference: one booking-specific account, never reused (ADR 0047).
    const digits = BigInt(`0x${createHash("sha256").update(`local-transfer:${request.reference}`).digest("hex").slice(0, 15)}`).toString().padStart(10, "0").slice(-10);
    return { bankName: LOCAL_TRANSFER_BANK_NAME, accountNumber: digits, reference: request.reference, expiresAt: request.expiresAt };
  }

  verifyTransfer(transferReference: string): BankTransferProviderResult {
    const issued = this.#lookup(transferReference);
    if (!issued) return { verified: false, status: "failed", amountKobo: 0, currency: "NGN", pspReference: transferReference, failureReason: "Unknown transfer reference" };
    return { verified: true, status: "success", amountKobo: issued.amountKobo, currency: "NGN", pspReference: transferReference, payerId: issued.payerId };
  }
}
