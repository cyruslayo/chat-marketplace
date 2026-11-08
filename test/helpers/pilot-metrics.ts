import { DatabaseSync } from "node:sqlite";
import { NodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import { BANK_TRANSFER_SCHEMA } from "../../domains/shortlet/src/index.js";
import type { LocalApartmentOwnerEnvironment } from "../../apps/local-owner/src/index.js";

/**
 * Narrow durable-store fixtures for the pilot metrics page (production-launch issue 09). The page aggregates
 * authoritative rows, so the tests seed only the rows whose payment status a deterministic provider cannot produce
 * (expired and failed checkouts, and the transfer methods the pilot does not offer).
 */

export interface PilotMetricsSeed {
  /** Inserts one card checkout session for the offer, as the Guest composition would have written it. */
  cardSession(offerId: string, status: "initiated" | "completed" | "expired" | "failed", reference?: string): void;
  manualTransfer(offerId: string, input: { readonly status: "awaiting_receipt" | "awaiting_verification" | "confirmed" | "rejected" | "expired"; readonly amountKobo: number; readonly refundOwedKobo?: number }): void;
  bankTransferSession(offerId: string, input: { readonly status: "initiated" | "processing_in_grace" | "completed" | "expired" | "refunded"; readonly amountKobo: number }): void;
  close(): void;
}

let sequence = 0;

export function pilotMetricsSeed(env: LocalApartmentOwnerEnvironment): PilotMetricsSeed {
  const database = new DatabaseSync(env.config.databasePath);
  database.exec("PRAGMA busy_timeout = 5000");
  const sql = new NodeSqliteDatabase(database);
  sql.exec(BANK_TRANSFER_SCHEMA);
  const next = (): number => { sequence += 1; return sequence; };
  return {
    cardSession(offerId, status, reference) {
      const id = next();
      sql.prepare(`INSERT INTO guest_checkout_sessions
        (checkout_id, offer_id, psp_reference, total_amount_due_now_kobo, amount_kobo, purpose, currency, contact_email, provider_environment, expires_at, status)
        VALUES (?, ?, ?, 0, 0, 'stay', 'NGN', 'payer@example.test', 'test', ?, ?)`)
        .run([`seed-checkout-${id}`, offerId, reference ?? `psp-ref-seed-${id}`, "2026-09-03T10:20:00.000Z", status]);
    },
    manualTransfer(offerId, input) {
      const id = next();
      const transfer = {
        transferId: `seed-transfer-${id}`,
        offerId,
        tenantId: env.config.tenantId,
        operatorId: env.config.operatorId,
        bookingReference: `SEED-${id}`,
        amountKobo: input.amountKobo,
        currency: "NGN",
        status: input.status,
        version: 1,
        startedAt: "2026-09-03T10:00:00.000Z",
        // Far future so the owner environment's lazy expiry sweep leaves the seeded status alone.
        paymentDeadlineAt: "2099-01-01T00:00:00.000Z",
        verificationDeadlineAt: "2099-01-01T00:00:00.000Z",
        stayCheckOut: "2099-01-02",
        ...(input.refundOwedKobo === undefined ? {} : {
          refundOwed: { bankTransactionReference: `LATE-${id}`, amountReceivedKobo: input.refundOwedKobo, recordedAt: "2026-09-03T10:30:00.000Z", recordedBy: "production-operations" },
        }),
      };
      sql.prepare("INSERT INTO manual_transfers (transfer_id, offer_id, booking_reference, seq, transfer_json) VALUES (?, ?, ?, ?, ?)")
        .run([transfer.transferId, offerId, transfer.bookingReference, id, JSON.stringify(transfer)]);
    },
    bankTransferSession(offerId, input) {
      const id = next();
      const session = { checkoutId: `seed-bank-${id}`, offerId, transferReference: `seed-bank-ref-${id}`, amountKobo: input.amountKobo, currency: "NGN", status: input.status };
      sql.prepare("INSERT INTO bank_transfer_sessions (transfer_reference, offer_id, seq, session_json) VALUES (?, ?, ?, ?)")
        .run([session.transferReference, offerId, id, JSON.stringify(session)]);
    },
    close() {
      if (database.isOpen) database.close();
    },
  };
}
