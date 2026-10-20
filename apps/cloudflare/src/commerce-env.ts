import type { R2Bucket } from "@cloudflare/workers-types";

/**
 * The commerce object's environment: its own bindings and settings only (ADR 0101). It names no Shortlet or pilot configuration,
 * so the commerce object can be typed without importing the Worker-wide env (final review, runtime coupling).
 */
export interface CommerceObjectEnv {
  readonly EXPORTS: R2Bucket;
  readonly SHORTLET_TENANT_ID?: string;
  readonly SHORTLET_EXPORT_RETENTION_DAYS?: string;
  readonly SHORTLET_RECEIPT_ORPHAN_GRACE_HOURS?: string;
  readonly COMMERCE_REFERENCE_HMAC_KEY?: string;
  readonly COMMERCE_REFERENCE_HMAC_KEY_ID?: string;
}
