import assert from "node:assert/strict";
import test from "node:test";
import { R2ProductImageStore } from "../apps/cloudflare/src/r2-product-image-store.js";

/** Issue 24 decision 8: the declared MIME type must match the file's magic bytes, not only the declared type and size. */

const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP_BYTES = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const WAVE_BYTES = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20]);

/** A bucket that records writes, so a test can tell an accepted upload from a refused one. */
function recordingStore() {
  const keys: string[] = [];
  const bucket = { put: async (key: string) => { keys.push(key); } };
  const store = new R2ProductImageStore(bucket as unknown as ConstructorParameters<typeof R2ProductImageStore>[0]);
  return { store, keys };
}

test("issue 24 decision 8: JPEG bytes are accepted as image/jpeg, and a JPEG prefix is required", async () => {
  const { store, keys } = recordingStore();
  await store.put(JPEG_BYTES, "image/jpeg");
  assert.equal(keys.length, 1);
  await assert.rejects(store.put(PNG_BYTES, "image/jpeg"), /do not match/i);
  await assert.rejects(store.put(Uint8Array.from([0xff, 0xd8]), "image/jpeg"), /do not match/i);
  assert.equal(keys.length, 1);
});

test("issue 24 decision 8: PNG bytes are accepted as image/png, and the full 8-byte signature is required", async () => {
  const { store, keys } = recordingStore();
  await store.put(PNG_BYTES, "image/png");
  assert.equal(keys.length, 1);
  await assert.rejects(store.put(JPEG_BYTES, "image/png"), /do not match/i);
  await assert.rejects(store.put(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]), "image/png"), /do not match/i);
  assert.equal(keys.length, 1);
});

test("issue 24 decision 8: WebP bytes are accepted as image/webp, and both RIFF and WEBP markers are required", async () => {
  const { store, keys } = recordingStore();
  await store.put(WEBP_BYTES, "image/webp");
  assert.equal(keys.length, 1);
  await assert.rejects(store.put(WAVE_BYTES, "image/webp"), /do not match/i);
  await assert.rejects(store.put(JPEG_BYTES, "image/webp"), /do not match/i);
  await assert.rejects(store.put(WEBP_BYTES.slice(0, 8), "image/webp"), /do not match/i);
  assert.equal(keys.length, 1);
});
