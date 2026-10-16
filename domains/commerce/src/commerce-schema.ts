import type { SchemaMigration } from "../../../packages/platform-core/src/schema-migrations.js";

export const MERCHANT_SCHEMA = `CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

export const STORE_SCHEMA = `CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

export const PRODUCT_SCHEMA = `CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  image_keys_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

export const MERCHANT_OFFER_SCHEMA = `CREATE TABLE IF NOT EXISTS merchant_offers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  price_kobo INTEGER NOT NULL,
  compare_at_price_kobo INTEGER,
  stock INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

export const OFFER_VARIANT_SCHEMA = `CREATE TABLE IF NOT EXISTS offer_variants (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES merchant_offers(id),
  name TEXT NOT NULL,
  stock INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

export const DELIVERY_ZONE_SCHEMA = `CREATE TABLE IF NOT EXISTS delivery_zones (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  city TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  fee_kobo INTEGER NOT NULL,
  estimate TEXT,
  note TEXT,
  is_active INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

export const CART_LINE_SCHEMA = `CREATE TABLE IF NOT EXISTS cart_lines (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  offer_id TEXT NOT NULL REFERENCES merchant_offers(id),
  variant_id TEXT REFERENCES offer_variants(id),
  quantity INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

/** The commerce domain's ordered schema. Version 1 is merchants/stores; version 2 adds the catalogue; version 3 adds carts. */
export const COMMERCE_SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  { version: 1, name: "commerce baseline: merchants and stores", statements: [MERCHANT_SCHEMA, STORE_SCHEMA] },
  { version: 2, name: "commerce catalogue: products, offers, variants, delivery zones", statements: [PRODUCT_SCHEMA, MERCHANT_OFFER_SCHEMA, OFFER_VARIANT_SCHEMA, DELIVERY_ZONE_SCHEMA] },
  { version: 3, name: "commerce carts: server-side cart lines per task", statements: [CART_LINE_SCHEMA] },
];
