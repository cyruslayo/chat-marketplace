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

export const MERCHANT_ORDER_SCHEMA = `CREATE TABLE IF NOT EXISTS merchant_orders (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  public_code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_instagram TEXT,
  items_json TEXT NOT NULL,
  subtotal_kobo INTEGER NOT NULL,
  shipping_fee_kobo INTEGER NOT NULL,
  total_kobo INTEGER NOT NULL,
  status TEXT NOT NULL,
  shipping_address_json TEXT NOT NULL,
  delivery_zone_id TEXT REFERENCES delivery_zones(id),
  delivery_city TEXT,
  delivery_zone_name TEXT,
  delivery_provider TEXT,
  delivery_estimate TEXT,
  payment_reference TEXT NOT NULL UNIQUE,
  payment_verified_at TEXT,
  payment_event_id TEXT,
  inventory_restocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

/** Failed public-tracking attempts per existing order, for the lock window (issue 27). Never one row per unknown code. */
export const TRACKING_ATTEMPT_SCHEMA = `CREATE TABLE IF NOT EXISTS merchant_order_tracking_attempts (
  public_code TEXT PRIMARY KEY REFERENCES merchant_orders(public_code),
  failed_attempts INTEGER NOT NULL,
  window_started_at TEXT NOT NULL
)`;

/** The commerce domain's ordered schema: merchants/stores, catalogue, carts, orders, tracking attempts. */
export const COMMERCE_SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  { version: 1, name: "commerce baseline: merchants and stores", statements: [MERCHANT_SCHEMA, STORE_SCHEMA] },
  { version: 2, name: "commerce catalogue: products, offers, variants, delivery zones", statements: [PRODUCT_SCHEMA, MERCHANT_OFFER_SCHEMA, OFFER_VARIANT_SCHEMA, DELIVERY_ZONE_SCHEMA] },
  { version: 3, name: "commerce carts: server-side cart lines per task", statements: [CART_LINE_SCHEMA] },
  { version: 4, name: "commerce orders: merchant orders and lifecycle", statements: [MERCHANT_ORDER_SCHEMA] },
  { version: 5, name: "commerce order tracking: failed-attempt lock per public code", statements: [TRACKING_ATTEMPT_SCHEMA] },
];
