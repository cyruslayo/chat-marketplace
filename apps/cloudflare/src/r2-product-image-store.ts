import type { R2Bucket } from "@cloudflare/workers-types";
import { InteractionSecurityEngine } from "../../../packages/platform-core/src/interaction-security.js";

/** Issue 24 decision: raster product images only, at most 5 MiB each. Named here, never inline in `put`. */
export const PRODUCT_IMAGE_MIME_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

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
