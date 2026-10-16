/**
 * A Store is a Merchant's public trading presence. A Merchant may operate many Stores, and a Store is
 * surfaced to a Consumer only while it is active and its Merchant is verified (ADR 0100). The Store
 * fields follow instastore `supabase/migrations/0007_multi_store_foundation.sql`.
 */

export type StoreStatus = "active" | "suspended";

export interface Store {
  readonly id: string;
  readonly merchantId: string;
  readonly slug: string;
  readonly name: string;
  readonly status: StoreStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Ported from instastore 0007: `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`. SQLite has no `~`, so it is enforced here. */
const STORE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isStoreStatus(value: unknown): value is StoreStatus {
  return value === "active" || value === "suspended";
}

function nonBlank(value: unknown, field: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must have a non-blank ${field}`);
  }
  return value;
}

export function parseStoreRecord(value: unknown, label: string): Store {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (!isStoreStatus(status)) {
    throw new TypeError(`${label} has an unknown Store status`);
  }
  const slug = nonBlank(record.slug, "slug", label);
  if (!STORE_SLUG_PATTERN.test(slug)) {
    throw new TypeError(`${label} has a Store slug that is not URL-safe`);
  }
  return {
    id: nonBlank(record.id, "id", label),
    merchantId: nonBlank(record.merchantId, "merchantId", label),
    slug,
    name: nonBlank(record.name, "name", label),
    status,
    createdAt: nonBlank(record.createdAt, "createdAt", label),
    updatedAt: nonBlank(record.updatedAt, "updatedAt", label),
  };
}
