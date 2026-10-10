import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TEST_MANUAL_ACCOUNT, TEST_RECEIPTS, guestPaymentPage, multipartBody, type GuestPaymentPage } from "./helpers/guest-payment-page.js";

const manualPage = (g: GuestPaymentPage) => `${g.paymentPage}/manual-transfer`;

test("07b AC4: Nothing in the code produces a public or signed R2 URL", () => {
  const directory = join(import.meta.dirname, "..", "apps", "cloudflare", "src");
  const forbidden = /createPresignedUrl|publicUrl|presign|signedUrl|r2\.dev|r2\.cloudflarestorage/i;
  const offenders = readdirSync(directory).filter((name) => name.endsWith(".ts") && forbidden.test(readFileSync(join(directory, name), "utf8")));
  assert.deepEqual(offenders, [], `public or signed URL code in: ${offenders.join(", ")}`);
  // Failure path: the pattern does catch each forbidden construct.
  for (const sample of ["bucket.createPresignedUrl(key)", "const publicUrl = x", "https://pub-1.r2.dev/key"]) assert.match(sample, forbidden);
});

/** Sends a chunked POST (no content-length) and resolves with the status the server answered. */
function chunkedUpload(g: GuestPaymentPage, path: string, contentType: string, chunks: readonly Buffer[]): Promise<number> {
  const url = new URL(`${g.base}${path}`);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { cookie: g.cookie, accept: "text/html", "content-type": contentType, "transfer-encoding": "chunked" } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", (error) => (error as NodeJS.ErrnoException).code === "ECONNRESET" ? resolve(413) : reject(error));
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

test("07b AC3: A receipt upload over the limit is refused with 413 with and without content-length, and nothing is stored", async () => {
  const limit = 2 * 1024;
  const g = await guestPaymentPage({ config: { manualTransferAccount: TEST_MANUAL_ACCOUNT, receiptMaxBytes: limit } });
  const counts = () => {
    const db = new DatabaseSync(join(g.dir, "guest.sqlite"));
    try {
      return {
        rows: (db.prepare("SELECT COUNT(*) AS n FROM manual_transfer_receipts").get() as { n: number }).n,
        blobs: (db.prepare("SELECT COUNT(*) AS n FROM receipt_blobs").get() as { n: number }).n,
      };
    } finally { db.close(); }
  };
  try {
    await g.post(manualPage(g));
    g.advance(5 * 60_000);
    const oversized = Buffer.concat([TEST_RECEIPTS.png, Buffer.alloc(limit * 4)]);
    const form = multipartBody("receipt", "big.png", "image/png", oversized);

    // With a content-length: refused from the header, before the body is read.
    const declared = await g.postRaw(`${manualPage(g)}/receipt`, form.body, form.contentType, {});
    assert.equal(declared.status, 413);

    // Without one: the counter stops it after the limit.
    const half = Math.ceil(form.body.length / 2);
    assert.equal(await chunkedUpload(g, `${manualPage(g)}/receipt`, form.contentType, [form.body.subarray(0, half), form.body.subarray(half)]), 413);

    assert.deepEqual(counts(), { rows: 0, blobs: 0 }, "no metadata row and no object exist afterwards");
    assert.equal(g.env.manualTransfers!.current(g.offerId, g.now())!.status, "awaiting_receipt");

    // Failure path for the check itself: a receipt within the limit still goes through.
    const ok = multipartBody("receipt", "ok.png", "image/png", TEST_RECEIPTS.png);
    assert.equal((await g.postRaw(`${manualPage(g)}/receipt`, ok.body, ok.contentType, {})).status, 303);
    assert.deepEqual(counts(), { rows: 1, blobs: 1 });
  } finally { await g.close(); }
});
