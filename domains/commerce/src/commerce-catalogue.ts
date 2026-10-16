import type { SqlDatabase, SqlRow } from "../../../packages/platform-core/src/sql-database.js";
import { DELIVERY_ZONE_SCHEMA, MERCHANT_OFFER_SCHEMA, OFFER_VARIANT_SCHEMA, PRODUCT_SCHEMA } from "./commerce-schema.js";
import { parseDeliveryZoneRecord, type DeliveryCity, type DeliveryZone } from "./delivery-zone.js";
import { parseMerchantOfferRecord, parseOfferVariantRecord, parseProductRecord, type MerchantOffer, type OfferVariant, type Product } from "./product.js";

export interface ProductInput {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description?: string;
  readonly imageKeys?: readonly string[];
}

export interface MerchantOfferInput {
  readonly id: string;
  readonly productId: string;
  readonly storeId: string;
  readonly priceKobo: number;
  readonly compareAtPriceKobo?: number;
  readonly stock: number;
}

export interface OfferVariantInput {
  readonly id: string;
  readonly offerId: string;
  readonly name: string;
  readonly stock: number;
}

export interface DeliveryZoneInput {
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
}

export interface OfferSearchResult {
  readonly offerId: string;
  readonly productId: string;
  readonly storeId: string;
  readonly productName: string;
  readonly category: string;
  readonly description: string;
  readonly imageKeys: readonly string[];
  readonly priceKobo: number;
  readonly compareAtPriceKobo?: number;
  readonly stock: number;
  readonly createdAt: string;
}

export type CatalogSort = "newest" | "price-asc" | "price-desc";

function readImageKeys(value: unknown, label: string): readonly string[] {
  if (typeof value !== "string") throw new TypeError(`${label} has malformed image keys`);
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > 4 || parsed.some((key) => typeof key !== "string" || key.trim() === "")) {
    throw new TypeError(`${label} has malformed image keys`);
  }
  return parsed as string[];
}

function readOfferSearchResult(row: SqlRow): OfferSearchResult {
  const compareAt = row.compare_at_price_kobo;
  return {
    offerId: String(row.offer_id),
    productId: String(row.product_id),
    storeId: String(row.store_id),
    productName: String(row.product_name),
    category: String(row.category),
    description: String(row.description),
    imageKeys: readImageKeys(row.image_keys_json, "Offer search result"),
    priceKobo: Number(row.price_kobo),
    ...(compareAt === null || compareAt === undefined ? {} : { compareAtPriceKobo: Number(compareAt) }),
    stock: Number(row.stock),
    createdAt: String(row.created_at),
  };
}

function readVariant(row: SqlRow): OfferVariant {
  return parseOfferVariantRecord(
    { id: row.id, offerId: row.offer_id, name: row.name, stock: row.stock, createdAt: row.created_at, updatedAt: row.updated_at },
    "Stored Offer Variant",
  );
}

function readDeliveryZone(row: SqlRow): DeliveryZone {
  return parseDeliveryZoneRecord(
    {
      id: row.id,
      storeId: row.store_id,
      city: row.city,
      name: row.name,
      provider: row.provider,
      feeKobo: row.fee_kobo,
      estimate: row.estimate,
      note: row.note,
      isActive: row.is_active === 1,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    "Stored Delivery Zone",
  );
}

function matchesQuery(result: OfferSearchResult, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${result.productName} ${result.category} ${result.description}`.toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function sortResults(results: OfferSearchResult[], sort: CatalogSort): OfferSearchResult[] {
  return [...results].sort((a, b) => {
    if (sort === "price-asc") return a.priceKobo - b.priceKobo;
    if (sort === "price-desc") return b.priceKobo - a.priceKobo;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

/** The read/write repository for the commerce catalogue: products, offers, variants and delivery zones. */
export class CommerceCatalogue {
  constructor(private readonly database: SqlDatabase, private readonly clock: () => Date) {
    database.exec(PRODUCT_SCHEMA);
    database.exec(MERCHANT_OFFER_SCHEMA);
    database.exec(OFFER_VARIANT_SCHEMA);
    database.exec(DELIVERY_ZONE_SCHEMA);
  }

  createProduct(input: ProductInput): Product {
    const now = this.clock().toISOString();
    const product = parseProductRecord(
      { ...input, description: input.description ?? "", imageKeys: input.imageKeys ?? [], createdAt: now, updatedAt: now },
      "Product",
    );
    this.database
      .prepare("INSERT INTO products (id, name, category, description, image_keys_json, created_at, updated_at) VALUES ($id, $name, $category, $description, $imageKeysJson, $createdAt, $updatedAt)")
      .run({
        $id: product.id,
        $name: product.name,
        $category: product.category,
        $description: product.description,
        $imageKeysJson: JSON.stringify(product.imageKeys),
        $createdAt: product.createdAt,
        $updatedAt: product.updatedAt,
      });
    return product;
  }

  createOffer(input: MerchantOfferInput): MerchantOffer {
    const now = this.clock().toISOString();
    const offer = parseMerchantOfferRecord({ ...input, createdAt: now, updatedAt: now }, "Merchant Offer");
    this.database
      .prepare("INSERT INTO merchant_offers (id, product_id, store_id, price_kobo, compare_at_price_kobo, stock, created_at, updated_at) VALUES ($id, $productId, $storeId, $priceKobo, $compareAt, $stock, $createdAt, $updatedAt)")
      .run({
        $id: offer.id,
        $productId: offer.productId,
        $storeId: offer.storeId,
        $priceKobo: offer.priceKobo,
        $compareAt: offer.compareAtPriceKobo ?? null,
        $stock: offer.stock,
        $createdAt: offer.createdAt,
        $updatedAt: offer.updatedAt,
      });
    return offer;
  }

  createVariant(input: OfferVariantInput): OfferVariant {
    const now = this.clock().toISOString();
    const variant = parseOfferVariantRecord({ ...input, createdAt: now, updatedAt: now }, "Offer Variant");
    this.database
      .prepare("INSERT INTO offer_variants (id, offer_id, name, stock, created_at, updated_at) VALUES ($id, $offerId, $name, $stock, $createdAt, $updatedAt)")
      .run({ $id: variant.id, $offerId: variant.offerId, $name: variant.name, $stock: variant.stock, $createdAt: variant.createdAt, $updatedAt: variant.updatedAt });
    return variant;
  }

  updateOfferPrice(offerId: string, priceKobo: number): void {
    if (typeof priceKobo !== "number" || !Number.isInteger(priceKobo) || priceKobo < 0) {
      throw new TypeError("The offer must have a non-negative integer priceKobo");
    }
    const result = this.database
      .prepare("UPDATE merchant_offers SET price_kobo = $priceKobo, updated_at = $updatedAt WHERE id = $id")
      .run({ $priceKobo: priceKobo, $updatedAt: this.clock().toISOString(), $id: offerId });
    if (result.changes === 0) throw new Error("The offer does not exist.");
  }

  createDeliveryZone(input: DeliveryZoneInput): DeliveryZone {
    const now = this.clock().toISOString();
    const zone = parseDeliveryZoneRecord({ ...input, createdAt: now, updatedAt: now }, "Delivery Zone");
    this.database
      .prepare("INSERT INTO delivery_zones (id, store_id, city, name, provider, fee_kobo, estimate, note, is_active, sort_order, created_at, updated_at) VALUES ($id, $storeId, $city, $name, $provider, $feeKobo, $estimate, $note, $isActive, $sortOrder, $createdAt, $updatedAt)")
      .run({
        $id: zone.id,
        $storeId: zone.storeId,
        $city: zone.city,
        $name: zone.name,
        $provider: zone.provider,
        $feeKobo: zone.feeKobo,
        $estimate: zone.estimate ?? null,
        $note: zone.note ?? null,
        $isActive: zone.isActive ? 1 : 0,
        $sortOrder: zone.sortOrder,
        $createdAt: zone.createdAt,
        $updatedAt: zone.updatedAt,
      });
    return zone;
  }

  /** AC1: only in-stock offers of active stores of verified merchants are searchable. */
  searchOffers(input: { readonly query?: string; readonly category?: string; readonly sort?: CatalogSort } = {}): readonly OfferSearchResult[] {
    const rows = this.database
      .prepare(
        `SELECT o.id AS offer_id, o.product_id, o.store_id, o.price_kobo, o.compare_at_price_kobo, o.stock, o.created_at,
                p.name AS product_name, p.category, p.description, p.image_keys_json
         FROM merchant_offers o
         JOIN products p ON p.id = o.product_id
         JOIN stores s ON s.id = o.store_id
         JOIN merchants m ON m.id = s.merchant_id
         WHERE m.status = 'verified' AND s.status = 'active' AND o.stock > 0`,
      )
      .all()
      .map(readOfferSearchResult);

    let results = rows;
    if (input.query && input.query.trim() !== "") results = results.filter((result) => matchesQuery(result, input.query!));
    if (input.category && input.category !== "all") results = results.filter((result) => result.category === input.category);
    return sortResults(results, input.sort ?? "newest");
  }

  /** AC2: a variant carries its own stock, and an out-of-stock variant fails closed. */
  selectVariant(offerId: string, variantId: string): OfferVariant {
    const row = this.database
      .prepare("SELECT id, offer_id, name, stock, created_at, updated_at FROM offer_variants WHERE id = $variantId AND offer_id = $offerId")
      .get({ $variantId: variantId, $offerId: offerId });
    if (!row) throw new Error("The variant is not available for this offer.");
    const variant = readVariant(row);
    if (variant.stock <= 0) throw new Error("The variant is out of stock.");
    return variant;
  }

  /** AC3: only active zones belonging to the given store are quoted. */
  activeDeliveryZones(storeId: string): readonly DeliveryZone[] {
    return this.database
      .prepare(
        `SELECT id, store_id, city, name, provider, fee_kobo, estimate, note, is_active, sort_order, created_at, updated_at
         FROM delivery_zones
         WHERE store_id = $storeId AND is_active = 1
         ORDER BY city, sort_order, name`,
      )
      .all({ $storeId: storeId })
      .map(readDeliveryZone);
  }
}
