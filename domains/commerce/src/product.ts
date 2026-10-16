/**
 * The commerce catalogue (ADR 0100): a Product is the shared descriptive identity, a Merchant Offer is a
 * store-specific purchasable proposition for that product, and an Offer Variant carries its own stock.
 */

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly imageKeys: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MerchantOffer {
  readonly id: string;
  readonly productId: string;
  readonly storeId: string;
  readonly priceKobo: number;
  readonly compareAtPriceKobo?: number;
  readonly stock: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OfferVariant {
  readonly id: string;
  readonly offerId: string;
  readonly name: string;
  readonly stock: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** instastore 0013: `gallery_images` holds at most four entries. */
const MAX_IMAGE_KEYS = 4;

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

function parseImageKeys(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_IMAGE_KEYS || value.some((key) => typeof key !== "string" || key.trim() === "")) {
    throw new TypeError(`${label} must have at most ${MAX_IMAGE_KEYS} non-blank image keys`);
  }
  return value as string[];
}

export function parseProductRecord(value: unknown, label: string): Product {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  return {
    id: nonBlank(record.id, "id", label),
    name: nonBlank(record.name, "name", label),
    category: nonBlank(record.category, "category", label),
    description: typeof record.description === "string" ? record.description : "",
    imageKeys: parseImageKeys(record.imageKeys, label),
    createdAt: nonBlank(record.createdAt, "createdAt", label),
    updatedAt: nonBlank(record.updatedAt, "updatedAt", label),
  };
}

export function parseMerchantOfferRecord(value: unknown, label: string): MerchantOffer {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const priceKobo = nonNegativeInteger(record.priceKobo, "priceKobo", label);
  const compareAt = record.compareAtPriceKobo;
  if (compareAt !== undefined && compareAt !== null && (typeof compareAt !== "number" || !Number.isInteger(compareAt) || compareAt <= priceKobo)) {
    throw new TypeError(`${label} must have a compare-at price above the price`);
  }
  return {
    id: nonBlank(record.id, "id", label),
    productId: nonBlank(record.productId, "productId", label),
    storeId: nonBlank(record.storeId, "storeId", label),
    priceKobo,
    ...(compareAt !== undefined && compareAt !== null ? { compareAtPriceKobo: compareAt } : {}),
    stock: nonNegativeInteger(record.stock, "stock", label),
    createdAt: nonBlank(record.createdAt, "createdAt", label),
    updatedAt: nonBlank(record.updatedAt, "updatedAt", label),
  };
}

export function parseOfferVariantRecord(value: unknown, label: string): OfferVariant {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  return {
    id: nonBlank(record.id, "id", label),
    offerId: nonBlank(record.offerId, "offerId", label),
    name: nonBlank(record.name, "name", label),
    stock: nonNegativeInteger(record.stock, "stock", label),
    createdAt: nonBlank(record.createdAt, "createdAt", label),
    updatedAt: nonBlank(record.updatedAt, "updatedAt", label),
  };
}
