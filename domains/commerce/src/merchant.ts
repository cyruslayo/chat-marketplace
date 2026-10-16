/**
 * The Merchant is the seller of record (ADR 0001). Its identity anchors one or more Stores, and a
 * Merchant must be verified before any of its Stores is surfaced to a Consumer (ADR 0100).
 */

export type MerchantStatus = "pending" | "verified" | "suspended";

export interface Merchant {
  readonly id: string;
  readonly name: string;
  readonly status: MerchantStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isMerchantStatus(value: unknown): value is MerchantStatus {
  return value === "pending" || value === "verified" || value === "suspended";
}

function nonBlank(value: unknown, field: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must have a non-blank ${field}`);
  }
  return value;
}

export function parseMerchantRecord(value: unknown, label: string): Merchant {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (!isMerchantStatus(status)) {
    throw new TypeError(`${label} has an unknown Merchant status`);
  }
  return {
    id: nonBlank(record.id, "id", label),
    name: nonBlank(record.name, "name", label),
    status,
    createdAt: nonBlank(record.createdAt, "createdAt", label),
    updatedAt: nonBlank(record.updatedAt, "updatedAt", label),
  };
}
