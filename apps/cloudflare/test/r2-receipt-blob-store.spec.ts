import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { SqliteManualTransferStore } from "../../../domains/shortlet/src/manual-transfer.js";
import { BodyTooLargeError, readBodyWithLimit } from "../src/bounded-body.js";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { R2ReceiptBlobStore } from "../src/r2-receipt-blob-store.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 254, 255]);
const everyByte = Uint8Array.from({ length: 256 }, (_, index) => index);
const store = () => new R2ReceiptBlobStore(env.RECEIPTS);

async function listedKeys(): Promise<string[]> {
  return (await env.RECEIPTS.list()).objects.map((object) => object.key);
}

test("07b AC1: Put, get and delete round-trip bytes and content type through R2 in workerd", async () => {
  const key = crypto.randomUUID();
  await store().put(key, PNG, "image/png");
  const found = await store().get(key);
  expect(found?.contentType).toBe("image/png");
  expect(Array.from(found!.bytes)).toEqual(Array.from(PNG));

  const binary = crypto.randomUUID();
  await store().put(binary, everyByte, "application/pdf");
  expect(Array.from((await store().get(binary))!.bytes)).toEqual(Array.from(everyByte));

  await store().delete(key);
  expect(await store().get(key)).toBeNull();
  expect((await store().get(binary))?.contentType).toBe("application/pdf");
  await store().delete(binary);
});

test("07b AC2: get of a missing key returns null, and delete of a missing key does not throw", async () => {
  const missing = crypto.randomUUID();
  expect(await store().get(missing)).toBeNull();
  await expect(store().delete(missing)).resolves.toBeUndefined();
  await expect(store().delete(missing)).resolves.toBeUndefined();
});

function streamOf(chunkBytes: number, limitOnPulls = Infinity) {
  const state = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls += 1;
      if (state.pulls > limitOnPulls) return controller.close();
      controller.enqueue(new Uint8Array(chunkBytes));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

test("07b AC3: An upload over the configured limit is refused before the whole body is buffered, with a declared length", async () => {
  const { stream, state } = streamOf(1024);
  const request = new Request("https://pilot.example.test/receipt", { method: "POST", body: stream, headers: { "content-length": String(10 * 1024 * 1024) } });
  await expect(readBodyWithLimit(request, 5 * 1024 * 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  expect(state.pulls, "no byte of an oversized declared upload is read").toBeLessThanOrEqual(1);
  expect(await listedKeys()).toEqual([]);
});

test("07b AC3: An upload over the configured limit is refused before the whole body is buffered, without a content-length", async () => {
  // An endless chunked body: the counter must stop it, not buffer it.
  const { stream, state } = streamOf(1024);
  const request = new Request("https://pilot.example.test/receipt", { method: "POST", body: stream });
  await expect(readBodyWithLimit(request, 4 * 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  expect(state.cancelled, "the stream is cancelled, not drained").toBe(true);
  expect(state.pulls).toBeLessThan(20);
  expect(await listedKeys()).toEqual([]);
});

test("07b AC3: a body within the limit is read whole, with and without a content-length", async () => {
  const { stream } = streamOf(1024, 3);
  const body = await readBodyWithLimit(new Request("https://pilot.example.test/receipt", { method: "POST", body: stream }), 4 * 1024);
  expect(body.byteLength).toBe(3 * 1024);
  const small = await readBodyWithLimit(new Request("https://pilot.example.test/receipt", { method: "POST", body: PNG, headers: { "content-length": String(PNG.byteLength) } }), 1024);
  expect(Array.from(small)).toEqual(Array.from(PNG));
  expect((await readBodyWithLimit(new Request("https://pilot.example.test/receipt"), 10)).byteLength).toBe(0);
});

test("07b: the manual transfer store keeps metadata in the Durable Object and bytes in R2, and migrates an old table in workerd", async () => {
  const stub = env.TEST_HARNESS.get(env.TEST_HARNESS.idFromName(`07b-store-${crypto.randomUUID()}`));
  await runInDurableObject(stub, async (_instance, ctx) => {
    const database = new DurableObjectSqlDatabase(ctx.storage);
    // The original table shape with a receipt already in it.
    database.exec("CREATE TABLE manual_transfer_receipts (receipt_id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL, content_type TEXT NOT NULL, bytes BLOB NOT NULL)");
    database.prepare("INSERT INTO manual_transfer_receipts (receipt_id, transfer_id, content_type, bytes) VALUES (?, ?, ?, ?)").run(["old", "old-transfer", "image/png", PNG]);

    const transfers = new SqliteManualTransferStore(database, store());
    expect(Array.from((await transfers.readReceipt("old"))!.bytes)).toEqual(Array.from(PNG));

    const objectKey = await transfers.putReceiptBytes("application/pdf", Buffer.from("%PDF-r2"));
    transfers.saveReceiptMetadata({ receiptId: "new", transferId: "new-transfer", contentType: "application/pdf", sizeBytes: 7, objectKey });
    expect(objectKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(database.prepare("SELECT bytes, size_bytes FROM manual_transfer_receipts WHERE receipt_id = 'new'").get()).toEqual({ bytes: null, size_bytes: 7 });
    expect((await transfers.readReceipt("new"))?.bytes.toString()).toBe("%PDF-r2");
    expect(await listedKeys()).toContain(objectKey);

    new SqliteManualTransferStore(database, store());
    expect(database.prepare("SELECT COUNT(*) AS count FROM manual_transfer_receipts").get()?.count).toBe(2);

    await transfers.deleteReceipt("new");
    await transfers.deleteReceipt("old");
    expect(await transfers.readReceipt("new")).toBeNull();
    expect(await listedKeys()).not.toContain(objectKey);
  });
});
