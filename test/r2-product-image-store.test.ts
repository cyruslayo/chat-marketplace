import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_IMAGE_MAX_BYTES, R2ProductImageStore } from "../apps/cloudflare/src/r2-product-image-store.js";
import { JPEG_FILE, PNG_FILE, WEBP_FILE, recordingBucket } from "./helpers/product-image-fixtures.js";

/**
 * Issue 24 decision 8: the declared MIME type must match the file's magic bytes. This is a node unit test; the store has no
 * production caller until the merchant back-office issue (issue 24 decision 9).
 */

const WAVE_FILE = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20]);

test("issue 24 decision 8: JPEG bytes are accepted as image/jpeg, and a JPEG prefix is required", async () => {
  const { bucket, keys } = recordingBucket();
  await new R2ProductImageStore(bucket).put(JPEG_FILE, "image/jpeg");
  assert.equal(keys.length, 1);
  await assert.rejects(new R2ProductImageStore(bucket).put(PNG_FILE, "image/jpeg"), /do not match/i);
  await assert.rejects(new R2ProductImageStore(bucket).put(Uint8Array.from([0xff, 0xd8]), "image/jpeg"), /do not match/i);
  assert.equal(keys.length, 1);
});

test("issue 24 decision 8: PNG bytes are accepted as image/png, and the full 8-byte signature is required", async () => {
  const { bucket, keys } = recordingBucket();
  await new R2ProductImageStore(bucket).put(PNG_FILE, "image/png");
  assert.equal(keys.length, 1);
  await assert.rejects(new R2ProductImageStore(bucket).put(JPEG_FILE, "image/png"), /do not match/i);
  await assert.rejects(new R2ProductImageStore(bucket).put(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]), "image/png"), /do not match/i);
  assert.equal(keys.length, 1);
});

test("issue 24 decision 8: WebP bytes are accepted as image/webp, and both RIFF and WEBP markers are required", async () => {
  const { bucket, keys } = recordingBucket();
  await new R2ProductImageStore(bucket).put(WEBP_FILE, "image/webp");
  assert.equal(keys.length, 1);
  await assert.rejects(new R2ProductImageStore(bucket).put(WAVE_FILE, "image/webp"), /do not match/i);
  await assert.rejects(new R2ProductImageStore(bucket).put(JPEG_FILE, "image/webp"), /do not match/i);
  await assert.rejects(new R2ProductImageStore(bucket).put(WEBP_FILE.slice(0, 8), "image/webp"), /do not match/i);
  assert.equal(keys.length, 1);
});

test("issue 24 decision 8 (policy 18 Oct 2026): an upload over the 5 MiB limit is refused by size before any write", async () => {
  const { bucket, keys } = recordingBucket();
  await assert.rejects(new R2ProductImageStore(bucket).put(new Uint8Array(PRODUCT_IMAGE_MAX_BYTES + 1), "image/png"), /size exceeds maximum/);
  assert.equal(keys.length, 0);
});

test("issue 24 decision 8 (policy 18 Oct 2026): a type outside JPEG, PNG and WebP is refused before any write", async () => {
  const { bucket, keys } = recordingBucket();
  await assert.rejects(new R2ProductImageStore(bucket).put(PNG_FILE, "image/gif"), /disallowed/);
  await assert.rejects(new R2ProductImageStore(bucket).put(PNG_FILE, "application/pdf"), /disallowed/);
  assert.equal(keys.length, 0);
});
