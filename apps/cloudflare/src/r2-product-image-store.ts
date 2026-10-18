import type { R2Bucket } from "@cloudflare/workers-types";
import { InteractionSecurityEngine } from "../../../packages/platform-core/src/interaction-security.js";

/**
 * Policy source: the user's decision of 18 Oct 2026, recorded in issue 24 under "Implementation decisions, 18 Oct 2026"
 * (decisions 8 and 9): raster product images only, at most 5 MiB each. Named here, never inline in `put`.
 */
export const PRODUCT_IMAGE_MIME_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Issue 24 decision 8: magic-byte signatures. The declared MIME type must match the file's leading bytes, so a renamed or
 * mislabelled file is refused. A type without a signature here is refused too (fail closed).
 */
export const JPEG_SIGNATURE: readonly number[] = [0xff, 0xd8, 0xff];
export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** WebP is a RIFF container: "RIFF" at offset 0, then four size bytes, then "WEBP" at offset 8. */
export const WEBP_RIFF_SIGNATURE: readonly number[] = [0x52, 0x49, 0x46, 0x46];
export const WEBP_FORM_SIGNATURE: readonly number[] = [0x57, 0x45, 0x42, 0x50];
const WEBP_FORM_OFFSET = 8;
const WEBP_MIN_BYTES = WEBP_FORM_OFFSET + WEBP_FORM_SIGNATURE.length;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** True only when the leading bytes match the signature for the declared MIME type. */
export function bytesMatchMimeType(bytes: Uint8Array, mimeType: string): boolean {
  switch (mimeType) {
    case "image/jpeg": return startsWith(bytes, JPEG_SIGNATURE);
    case "image/png": return startsWith(bytes, PNG_SIGNATURE);
    case "image/webp": return bytes.byteLength >= WEBP_MIN_BYTES && startsWith(bytes, WEBP_RIFF_SIGNATURE) && startsWith(bytes, WEBP_FORM_SIGNATURE, WEBP_FORM_OFFSET);
    default: return false;
  }
}

export interface ProductImagePolicy {
  readonly allowedMimeTypes: readonly string[];
  readonly maxSizeBytes: number;
}

const DEFAULT_PRODUCT_IMAGE_POLICY: ProductImagePolicy = { allowedMimeTypes: PRODUCT_IMAGE_MIME_TYPES, maxSizeBytes: PRODUCT_IMAGE_MAX_BYTES };
const uploadSafety = new InteractionSecurityEngine();

/** Private R2 storage for product images (ADR 0101). Keys are generated here and are never public URLs. */
export class R2ProductImageStore {
  constructor(private readonly bucket: R2Bucket, private readonly policy: ProductImagePolicy = DEFAULT_PRODUCT_IMAGE_POLICY) {}

  async put(bytes: Uint8Array, contentType: string): Promise<string> {
    if (bytes.byteLength === 0 || !contentType.trim()) throw new Error("Image bytes and content type are required");
    // Uploads carry no client filename, so the engine's extension check sees a fixed neutral name.
    uploadSafety.validateFileUpload(
      { filename: "product-image", mimeType: contentType, sizeBytes: bytes.byteLength },
      { allowedMimeTypes: [...this.policy.allowedMimeTypes], maxSizeBytes: this.policy.maxSizeBytes },
    );
    if (!bytesMatchMimeType(bytes, contentType)) throw new Error("Image bytes do not match the declared content type");
    const key = `product-images/${crypto.randomUUID()}`;
    await this.bucket.put(key, bytes, { httpMetadata: { contentType } });
    return key;
  }

  async get(key: string): Promise<{ readonly bytes: Uint8Array; readonly contentType: string } | null> {
    if (!key.startsWith("product-images/") || key.length <= "product-images/".length) return null;
    const object = await this.bucket.get(key);
    if (!object) return null;
    return { bytes: new Uint8Array(await object.arrayBuffer()), contentType: object.httpMetadata?.contentType ?? "application/octet-stream" };
  }

  async delete(key: string): Promise<void> {
    if (!key.startsWith("product-images/") || key.length <= "product-images/".length) throw new Error("Invalid product image key");
    await this.bucket.delete(key);
  }
}
