import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { toHttpRequestLike, createHttpResponseLike } from "../packages/platform-core/src/http-fetch-shim.js";
import { createGuestRequestHandler } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { TEST_MANUAL_ACCOUNT, TEST_RECEIPTS, multipartBody } from "./helpers/guest-payment-page.js";
import type { HttpRequestLike, HttpResponseLike } from "../packages/platform-core/src/http-like.js";
import type { Unit } from "../domains/shortlet/src/index.js";

const PAYSTACK_SECRET = "sk_test_shim_evidence";
const WEBHOOK_BYTES = Buffer.from([
  0x7b, 0x22, 0x65, 0x76, 0x65, 0x6e, 0x74, 0x22, 0x3a, 0x22, 0x63, 0x68, 0x61, 0x72, 0x67, 0x65, 0xff, 0xfe, 0x2e,
]);

function webhookSignature(body: Buffer): string {
  return createHmac("sha256", PAYSTACK_SECRET).update(body).digest("hex");
}

/** Drives the handler like the Durable Object wiring does (slice 09c): a Web Request in, a Web Response out. */
async function throughShim(
  handler: { handle(req: HttpRequestLike, res: HttpResponseLike): Promise<void> },
  request: Request,
): Promise<Response> {
  const responseStream = createHttpResponseLike();
  try {
    await handler.handle(toHttpRequestLike(request), responseStream.response);
  } catch (error) {
    responseStream.response.destroy(error instanceof Error ? error : new Error(String(error)));
  }
  return await responseStream.done;
}

test("09c AC1: a webhook POST body arrives byte for byte, including non-UTF-8 bytes", async () => {
  const seenSignatures: boolean[] = [];
  const seenLengths: string[] = [];
  const webhookHandler = {
    handle: async (req: HttpRequestLike, res: HttpResponseLike): Promise<void> => {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        req.on("data", (chunk: Buffer) => { chunks.push(chunk); });
        req.on("end", () => { resolve(); });
        req.on("error", reject);
      });
      const body = Buffer.concat(chunks);
      seenLengths.push(String(body.length));
      seenSignatures.push(req.headers["x-paystack-signature"] === webhookSignature(body));
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: seenSignatures.at(-1) ?? false }));
    },
  };
  const response = await throughShim(webhookHandler, new Request("https://pilot.example/webhooks/paystack", {
    method: "POST",
    body: new Uint8Array(WEBHOOK_BYTES),
    headers: { "x-paystack-signature": webhookSignature(WEBHOOK_BYTES) },
  }));
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(seenLengths, [String(WEBHOOK_BYTES.length)]);
  // Failure path: changing one byte makes the signature check fail.
  const tampered = Buffer.from(WEBHOOK_BYTES);
  tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0x01;
  const tamperedResponse = await throughShim(webhookHandler, new Request("https://pilot.example/webhooks/paystack", {
    method: "POST",
    body: new Uint8Array(tampered),
    headers: { "x-paystack-signature": webhookSignature(WEBHOOK_BYTES) },
  }));
  assert.deepEqual(await tamperedResponse.json(), { ok: false });
  assert.deepEqual(seenSignatures, [true, false]);
});

test("09c AC2: a multipart receipt upload (no-JS form, ADR 0080) parses in the guest handler through the shim", async () => {
  const directory = mkdtempSync(join(tmpdir(), "shim-multipart-"));
  try {
    const fixedClock = new Date("2026-09-03T10:02:00.000Z");
    const environment: LocalGuestEnvironment = LocalGuestEnvironment.openNode({
      databasePath: join(directory, "guest.sqlite"),
      initialGuestPhoneNumber: "+2348012345678",
      initialGuestContactEmail: "guest@example.test",
      manualTransferAccount: TEST_MANUAL_ACCOUNT,
      clock: () => fixedClock,
    });
    const handler = createGuestRequestHandler({ environment, localPayment: true, conciergeMode: "deterministic" });
    const unit = environment.unitRepository.findById("unit-lagos-ikoyi-001") as Unit;
    environment.unitRepository.save({ ...unit, price: { ...unit.price, refundableSecurityDepositKobo: 0 } });
    const principal = environment.guestPrincipal();
    const draft = environment.bookingRequestApp.createDraft(
      {
        unitId: unit.id,
        primaryGuest: { id: environment.config.guestId, name: environment.config.guestName },
        occupants: environment.demoOccupants(2),
        selfBookingAttestation: environment.selfBookingAttestation(),
        checkIn: "2026-09-10",
        checkOut: "2026-09-13",
      },
      principal,
    );
    const request = environment.bookingRequestApp.disclose(draft.draftId, principal);
    const { offerId } = environment.simulateOperatorAcceptance(request.requestId);
    const offer = environment.conditionalOfferApp.getOffer(offerId);
    environment.conditionalOfferApp.accept({
      offerId,
      confirmationToken: offer.confirmationToken,
      expectedVersion: offer.offerVersion,
      principal,
    });

    const origin = "https://pilot.example";
    // A browser-like Guest session: GET / issues the session cookie; the shim must keep it intact (ADR 0086).
    const home = await throughShim(handler, new Request(`${origin}/`));
    assert.equal(home.status, 200);
    const cookie = home.headers.getSetCookie()[0]?.split(";")[0] ?? "";
    assert.match(cookie, /^shortlet_guest_session=/);
    // Start the manual transfer from the page's own plain form, then upload the receipt.
    const start = await throughShim(handler, new Request(`${origin}/payments/offers/${encodeURIComponent(offerId)}/manual-transfer`, { method: "POST", headers: { cookie } }));
    assert.equal(start.status, 303);
    const { body, contentType } = multipartBody("receipt", "receipt.png", "image/png", TEST_RECEIPTS.png);
    const upload = await throughShim(
      handler,
      new Request(`${origin}/payments/offers/${encodeURIComponent(offerId)}/manual-transfer/receipt`, {
        method: "POST",
        headers: { cookie, "content-type": contentType, "content-length": String(body.length) },
        body: new Uint8Array(body),
      }),
    );
    assert.equal(upload.status, 303, "the receipt upload parses and stores, exactly as the Node server does");
    assert.deepEqual(upload.headers.getSetCookie(), [], "the upload response sets no session cookie, as on Node");
    // The transfer page after the upload renders from the parsed receipt.
    const page = await throughShim(handler, new Request(`${origin}/payments/offers/${encodeURIComponent(offerId)}/manual-transfer`, { headers: { cookie, accept: "text/html" } }));
    assert.equal(page.status, 200);
    assert.match(await page.text(), /receipt/);
    await handler.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("09c AC4: destroy() and a thrown handler each yield 500, and no Promise is left hanging (node side)", async () => {
  const destroyHandler = {
    handle: async (req: HttpRequestLike, res: HttpResponseLike): Promise<void> => {
      res.destroy(new Error("the connection dies mid-send"));
    },
  };
  const response = await throughShim(destroyHandler, new Request("https://pilot.example/"));
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "Something went wrong");

  const throwingHandler = {
    handle: async (): Promise<void> => {
      throw new Error("unexpected handler fault");
    },
  };
  const thrown = await throughShim(throwingHandler, new Request("https://pilot.example/"));
  assert.equal(thrown.status, 500);
});
