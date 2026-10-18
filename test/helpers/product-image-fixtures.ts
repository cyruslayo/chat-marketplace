import type { R2ProductImageStore } from "../../apps/cloudflare/src/r2-product-image-store.js";

/**
 * Minimal files that carry each product image type's magic bytes (issue 24 decision 8). One shared fixture for every
 * product image test, so no test copies the bytes (issue 24 review 9).
 */
export const JPEG_FILE = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
export const PNG_FILE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
export const WEBP_FILE = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

/** A bucket double that records written keys, so a test can tell an accepted upload from a refused one. */
export function recordingBucket(): { readonly bucket: ConstructorParameters<typeof R2ProductImageStore>[0]; readonly keys: string[] } {
  const keys: string[] = [];
  const bucket = { put: async (key: string) => { keys.push(key); } };
  return { bucket: bucket as unknown as ConstructorParameters<typeof R2ProductImageStore>[0], keys };
}
