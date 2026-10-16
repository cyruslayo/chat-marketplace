/**
 * A Delivery Zone is a merchant-defined delivery price for one of the two launch cities. Fields and the
 * city/ordering rules follow instastore `0010_storefront_tenancy_and_delivery_zones.sql` and `0012`.
 */

export type DeliveryCity = "Abuja" | "Lagos";

export interface DeliveryZone {
  readonly id: string;
  readonly storeId: string;
  readonly city: DeliveryCity;
  readonly name: string;
  readonly provider: string;
  readonly feeKobo: number;
  readonly estimate?: string;
  readonly note?: string;
  readonly isActive: boolean;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isDeliveryCity(value: unknown): value is DeliveryCity {
  return value === "Abuja" || value === "Lagos";
}

function nonBlank(value: unknown, field: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must have a non-blank ${field}`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must have a non-negative integer ${field}`);
  }
  return value;
}

function optionalText(value: unknown, field: string, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new TypeError(`${label} must have a text ${field} or none`);
  return value;
}

export function parseDeliveryZoneRecord(value: unknown, label: string): DeliveryZone {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const city = record.city;
  if (!isDeliveryCity(city)) {
    throw new TypeError(`${label} has an unknown delivery city`);
  }
  if (typeof record.isActive !== "boolean") {
    throw new TypeError(`${label} must have a boolean isActive`);
  }
  return {
    id: nonBlank(record.id, "id", label),
    storeId: nonBlank(record.storeId, "storeId", label),
    city,
    name: nonBlank(record.name, "name", label),
    provider: nonBlank(record.provider, "provider", label),
    feeKobo: nonNegativeInteger(record.feeKobo, "feeKobo", label),
    estimate: optionalText(record.estimate, "estimate", label),
    note: optionalText(record.note, "note", label),
    isActive: record.isActive,
    sortOrder: nonNegativeInteger(record.sortOrder, "sortOrder", label),
    createdAt: nonBlank(record.createdAt, "createdAt", label),
    updatedAt: nonBlank(record.updatedAt, "updatedAt", label),
  };
}
