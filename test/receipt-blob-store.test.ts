import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/index.js";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { SqliteManualTransferStore, SqliteReceiptBlobStore, type ReceiptBlobStore } from "../domains/shortlet/src/index.js";
import { TEST_MANUAL_ACCOUNT, TEST_RECEIPTS, guestPaymentPage, multipartBody, type GuestPaymentPage } from "./helpers/guest-payment-page.js";

// 07a: receipt bytes go through a ReceiptBlobStore port (ADR 0090); Node keeps them in SQLite.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const withManual = () => guestPaymentPage({ config: { manualTransferAccount: TEST_MANUAL_ACCOUNT } });
const manualPage = (g: GuestPaymentPage) => `${g.paymentPage}/manual-transfer`;
const upload = (g: GuestPaymentPage, bytes: Buffer, type = "image/png") => {
  const form = multipartBody("receipt", "receipt.png", type, bytes);
  return g.postRaw(`${manualPage(g)}/receipt`, form.body, form.contentType, {});
};
function rows<T>(g: GuestPaymentPage, sql: string): T[] {
  const db = new DatabaseSync(join(g.dir, "guest.sqlite"));
  try { return db.prepare(sql).all() as T[]; } finally { db.close(); }
}

test("07a AC1: Uploading and reading a receipt on Node returns identical bytes and content type, with the bytes stored through SqliteReceiptBlobStore", async () => {
  const g = await withManual();
  try {
    await g.post(manualPage(g));
    g.advance(5 * 60_000);
    assert.equal((await upload(g, TEST_RECEIPTS.png)).status, 303);
    const transfer = g.env.manualTransfers!.current(g.offerId, g.now())!;
    const receipt = await g.env.manualTransfers!.readReceipt(transfer);
    assert.ok(receipt);
    assert.deepEqual(receipt.bytes, TEST_RECEIPTS.png);
    assert.equal(receipt.contentType, "image/png");

    const [metadata] = rows<{ bytes: unknown; object_key: string; size_bytes: number }>(g, "SELECT bytes, object_key, size_bytes FROM manual_transfer_receipts");
    assert.equal(metadata?.bytes, null, "the metadata row holds no bytes");
    assert.equal(metadata?.size_bytes, TEST_RECEIPTS.png.length);
    const [blob] = rows<{ object_key: string; content_type: string; bytes: Uint8Array }>(g, "SELECT object_key, content_type, bytes FROM receipt_blobs");
    assert.equal(blob?.object_key, metadata?.object_key, "the bytes sit in the blob store under the row's key");
    assert.deepEqual(Buffer.from(blob!.bytes), TEST_RECEIPTS.png);
  } finally { await g.close(); }
});

test("07a AC2: A database with receipts saved before the migration still serves them after it, and the migration is idempotent", async () => {
  const raw = new DatabaseSync(":memory:");
  const database = new NodeSqliteDatabase(raw);
  try {
    // The original shape: bytes inline, NOT NULL, no key.
    raw.exec("CREATE TABLE manual_transfer_receipts (receipt_id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL, content_type TEXT NOT NULL, bytes BLOB NOT NULL)");
    raw.prepare("INSERT INTO manual_transfer_receipts (receipt_id, transfer_id, content_type, bytes) VALUES (?, ?, ?, ?)").run("old-receipt", "old-transfer", "image/png", TEST_RECEIPTS.png);

    const store = new SqliteManualTransferStore(database);
    const first = await store.readReceipt("old-receipt");
    assert.deepEqual(first?.bytes, TEST_RECEIPTS.png);
    assert.equal(first?.contentType, "image/png");
    const migrated = raw.prepare("SELECT object_key, size_bytes FROM manual_transfer_receipts WHERE receipt_id = 'old-receipt'").get();
    assert.equal(migrated?.object_key, null);
    assert.equal(migrated?.size_bytes, TEST_RECEIPTS.png.length);

    // Running it again changes nothing, and new receipts use the new shape beside the old row.
    const schemaBefore = raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'manual_transfer_receipts'").get()?.sql;
    const again = new SqliteManualTransferStore(database);
    assert.equal(raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'manual_transfer_receipts'").get()?.sql, schemaBefore);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM manual_transfer_receipts").get()?.n, 1);
    again.saveReceiptMetadata({ receiptId: "new-receipt", transferId: "new-transfer", contentType: "application/pdf", sizeBytes: 3, objectKey: await again.putReceiptBytes("application/pdf", Buffer.from("%PD")) });
    assert.deepEqual((await again.readReceipt("new-receipt"))?.bytes, Buffer.from("%PD"));
    assert.deepEqual((await again.readReceipt("old-receipt"))?.bytes, TEST_RECEIPTS.png);

    // Deleting an old receipt needs no blob; deleting a new one removes both the bytes and the row.
    await again.deleteReceipt("old-receipt");
    await again.deleteReceipt("new-receipt");
    assert.equal(await again.readReceipt("old-receipt"), null);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM receipt_blobs").get()?.n, 0);
  } finally { raw.close(); }
});

test("07a AC3: Object keys never contain the booking reference, guest name or phone", async () => {
  const g = await withManual();
  try {
    await g.post(manualPage(g));
    g.advance(5 * 60_000);
    assert.equal((await upload(g, TEST_RECEIPTS.png)).status, 303);
    const transfer = g.env.manualTransfers!.current(g.offerId, g.now())!;
    const [{ object_key: key } = { object_key: "" }] = rows<{ object_key: string }>(g, "SELECT object_key FROM manual_transfer_receipts");
    assert.match(key, UUID);
    assert.ok(!key.includes(transfer.bookingReference));
    assert.ok(!key.includes(transfer.receipt!.receiptId));
    assert.doesNotMatch(key, /guest|\+?234|0801/i);
    // Failure path: a store that handed out a derived key would fail this same check.
    assert.doesNotMatch(`receipt-${transfer.bookingReference}`, UUID);
  } finally { await g.close(); }
});

test("07a AC4: If the blob put fails, no metadata row is written and the upload returns the existing error page", async () => {
  const g = await withManual();
  try {
    await g.post(manualPage(g));
    g.advance(5 * 60_000);
    // The blob table is gone, so every put fails exactly as an unreachable R2 would.
    const db = new DatabaseSync(join(g.dir, "guest.sqlite"));
    try { db.exec("DROP TABLE receipt_blobs"); } finally { db.close(); }

    const response = await upload(g, TEST_RECEIPTS.png);
    assert.equal(response.status, 409);
    assert.match(await response.text(), /The receipt was not accepted\. No payment was recorded\./);
    assert.deepEqual(rows(g, "SELECT * FROM manual_transfer_receipts"), []);
    const transfer = g.env.manualTransfers!.current(g.offerId, g.now())!;
    assert.equal(transfer.status, "awaiting_receipt");
    assert.equal(transfer.receipt, undefined);
  } finally { await g.close(); }
});

test("07a AC4: two uploads racing through the put leave one receipt and no orphan bytes", async () => {
  const g = await withManual();
  try {
    await g.post(manualPage(g));
    g.advance(5 * 60_000);
    const offer = g.env.conditionalOfferApp.getOffer(g.offerId);
    const command = () => createPlatformCommandEnvelope({
      commandName: "manual_transfer.upload_receipt",
      principal: { id: offer.parties.primaryGuest.id, role: "guest", tenantId: offer.tenantId ?? g.env.config.tenantId },
      payload: { offerId: g.offerId },
    });
    // Both pass the first check before either put finishes; the second is refused when it re-checks and its bytes are discarded.
    const results = await Promise.allSettled([
      g.env.manualTransfers!.uploadReceipt(command(), { bytes: TEST_RECEIPTS.png }, g.now),
      g.env.manualTransfers!.uploadReceipt(command(), { bytes: TEST_RECEIPTS.pdf }, g.now),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
    assert.equal(rows(g, "SELECT * FROM manual_transfer_receipts").length, 1);
    assert.equal(rows(g, "SELECT * FROM receipt_blobs").length, 1, "the refused upload left no orphan bytes");
  } finally { await g.close(); }
});

test("07a AC4: the port is used for every byte: a store with a spy blob store sees put, get and delete", async () => {
  const raw = new DatabaseSync(":memory:");
  const database = new NodeSqliteDatabase(raw);
  try {
    const inner = new SqliteReceiptBlobStore(database);
    const calls: string[] = [];
    const spy: ReceiptBlobStore = {
      put: (key, bytes, type) => { calls.push("put"); return inner.put(key, bytes, type); },
      get: (key) => { calls.push("get"); return inner.get(key); },
      delete: (key) => { calls.push("delete"); return inner.delete(key); },
    };
    const store = new SqliteManualTransferStore(database, spy);
    const objectKey = await store.putReceiptBytes("image/png", TEST_RECEIPTS.png);
    store.saveReceiptMetadata({ receiptId: "r", transferId: "t", contentType: "image/png", sizeBytes: TEST_RECEIPTS.png.length, objectKey });
    assert.deepEqual((await store.readReceipt("r"))?.bytes, TEST_RECEIPTS.png);
    await store.deleteReceipt("r");
    assert.deepEqual(calls, ["put", "get", "delete"]);
  } finally { raw.close(); }
});
