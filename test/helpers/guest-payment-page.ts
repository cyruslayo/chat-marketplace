import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment, type LocalGuestFixtureConfig } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import type { ManualTransferAccount, Unit } from "../../domains/shortlet/src/index.js";

/** A clearly fictional business account for manual transfer tests (ADR 0090). */
export const TEST_MANUAL_ACCOUNT: ManualTransferAccount = Object.freeze({ bankName: "Test Business Bank", accountName: "Shortlet Test Ltd", accountNumber: "1234567890" });

export function visibleText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ");
}

export interface GuestPaymentPage {
  readonly env: LocalGuestEnvironment;
  readonly dir: string;
  readonly offerId: string;
  readonly base: string;
  /** The Guest's browser-session cookie, for driving a real tab as the same Guest. */
  readonly cookie: string;
  readonly paymentPage: string;
  get(path: string): Promise<Response>;
  post(path: string, body?: Record<string, string>, headers?: Record<string, string>): Promise<Response>;
  /** POSTs a raw body (e.g. multipart) with the Guest's cookie. */
  postRaw(path: string, body: Buffer, contentType: string, headers?: Record<string, string>): Promise<Response>;
  advance(ms: number): void;
  now(): Date;
  /** Closes the server; keeps the database when `keep` is true (for restart tests). */
  close(keep?: boolean): Promise<void>;
}

/**
 * A Guest with an accepted, zero-deposit offer (ADR 0089), served by the local pilot server with its local payment
 * providers. The clock starts at `start` and moves only when the test advances it. Pass `existing` to reopen a
 * database after a restart.
 */
export async function guestPaymentPage(options: {
  readonly start?: string;
  readonly config?: Partial<LocalGuestFixtureConfig>;
  readonly dir?: string;
  readonly existing?: { readonly offerId: string };
} = {}): Promise<GuestPaymentPage> {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "guest-payment-"));
  let current = new Date(options.start ?? "2026-09-03T10:02:00.000Z");
  const env = new LocalGuestEnvironment({ databasePath: join(dir, "guest.sqlite"), initialGuestPhoneNumber: "+2348012345678", initialGuestContactEmail: "guest@example.test", clock: () => current, ...options.config });
  let offerId = options.existing?.offerId ?? "";
  if (!options.existing) {
    const unit = env.unitRepository.findById("unit-lagos-ikoyi-001") as Unit;
    env.unitRepository.save({ ...unit, price: { ...unit.price, refundableSecurityDepositKobo: 0 } });
    const draft = env.bookingRequestApp.createDraft({ unitId: unit.id, primaryGuest: { id: env.config.guestId, name: env.config.guestName }, occupants: env.demoOccupants(2), selfBookingAttestation: env.selfBookingAttestation(), checkIn: "2026-09-10", checkOut: "2026-09-13" }, env.guestPrincipal());
    const request = env.bookingRequestApp.disclose(draft.draftId, env.guestPrincipal());
    offerId = env.simulateOperatorAcceptance(request.requestId).offerId;
    const offer = env.conditionalOfferApp.manager.getOffer(offerId);
    env.conditionalOfferApp.accept({ offerId, confirmationToken: offer.confirmationToken, expectedVersion: offer.offerVersion, principal: env.guestPrincipal() });
  }
  const server = startLocalGuestServer({ port: 0, environment: env, localPayment: true, conciergeMode: "deterministic" });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const cookie = (await fetch(`${base}/`)).headers.get("set-cookie")?.split(";")[0] ?? "";
  return {
    env, dir, offerId, base, cookie,
    paymentPage: `/payments/offers/${encodeURIComponent(offerId)}`,
    get: (path) => fetch(`${base}${path}`, { headers: { cookie, accept: "text/html" }, redirect: "manual" }),
    post: (path, body = {}, headers = {}) => fetch(`${base}${path}`, { method: "POST", headers: { cookie, accept: "text/html", "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body), redirect: "manual" }),
    postRaw: (path, body, contentType, headers = {}) => fetch(`${base}${path}`, { method: "POST", headers: { cookie, accept: "text/html", "content-type": contentType, ...headers }, body: new Uint8Array(body), redirect: "manual" }),
    advance(ms) { current = new Date(current.getTime() + ms); },
    now: () => current,
    async close(keep = false) { await server.close(); if (!keep) rmSync(dir, { recursive: true, force: true }); },
  };
}

/** A multipart/form-data body with one file field, as a browser sends it. */
export function multipartBody(field: string, filename: string, contentType: string, bytes: Buffer): { readonly body: Buffer; readonly contentType: string } {
  const boundary = "----shortlet-test-boundary-7f3a";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, bytes, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Minimal valid-looking files: the domain checks the leading bytes. */
export const TEST_RECEIPTS = Object.freeze({
  png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]),
  pdf: Buffer.from("%PDF-1.4\n% test receipt\n"),
  text: Buffer.from("this is not a receipt image"),
});
