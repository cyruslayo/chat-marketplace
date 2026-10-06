import type { ReceiptBlob, ReceiptBlobStore } from "../../../domains/shortlet/src/receipt-blob-store.js";

const UNKNOWN_CONTENT_TYPE = "application/octet-stream";

/**
 * Receipt bytes in the private `RECEIPTS` bucket (ADR 0090, ADR 0075). Keys are the opaque random keys the manual
 * transfer store hands out. Nothing here creates a public URL, a signed URL or a custom domain: receipts leave the
 * bucket only through the back-office route that streams them after a grant check.
 */
export class R2ReceiptBlobStore implements ReceiptBlobStore {
  readonly #bucket: R2Bucket;
  constructor(bucket: R2Bucket) {
    this.#bucket = bucket;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.#bucket.put(key, bytes, { httpMetadata: { contentType } });
  }

  async get(key: string): Promise<ReceiptBlob | null> {
    const object = await this.#bucket.get(key);
    if (object === null) return null;
    return {
      bytes: new Uint8Array(await object.arrayBuffer()),
      contentType: object.httpMetadata?.contentType ?? UNKNOWN_CONTENT_TYPE,
    };
  }

  /** R2 deletes are idempotent: a missing key is not an error. */
  async delete(key: string): Promise<void> {
    await this.#bucket.delete(key);
  }
}
