import type { SqlDatabase, SqlRow } from "../../../packages/platform-core/src/sql-database.js";
import { CART_LINE_SCHEMA } from "./commerce-schema.js";

export interface CartLine {
  readonly lineId: string;
  readonly offerId: string;
  readonly variantId?: string;
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly priceKobo: number;
  readonly available: boolean;
}

export interface StoreCart {
  readonly storeId: string;
  readonly storeName: string;
  readonly lines: readonly CartLine[];
}

export interface MarketplaceCart {
  readonly taskId: string;
  readonly storeCarts: readonly StoreCart[];
}

export interface AddCartLineInput {
  readonly taskId: string;
  readonly offerId: string;
  readonly variantId?: string;
  readonly quantity: number;
}

function requirePositiveInteger(value: unknown, field: string, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must have a positive integer ${field}`);
  }
  return value;
}

function readCartLine(row: SqlRow): CartLine {
  const variantId = row.variant_id === null || row.variant_id === undefined ? undefined : String(row.variant_id);
  return {
    lineId: String(row.line_id),
    offerId: String(row.offer_id),
    ...(variantId === undefined ? {} : { variantId }),
    productId: String(row.product_id),
    productName: String(row.product_name),
    quantity: Number(row.quantity),
    priceKobo: Number(row.price_kobo),
    available: row.merchant_status === "verified" && row.store_status === "active",
  };
}

/**
 * A server-side Marketplace Cart keyed by task. Lines hold only (offer, optional variant, quantity);
 * prices are re-read from the current offer on every read, and a line is marked unavailable when its
 * store is suspended or its merchant is not verified (ADR 0100).
 */
export class CommerceCart {
  constructor(private readonly database: SqlDatabase, private readonly clock: () => Date) {
    database.exec(CART_LINE_SCHEMA);
  }

  addLine(input: AddCartLineInput): string {
    const quantity = requirePositiveInteger(input.quantity, "quantity", "Cart line");
    const offer = this.database.prepare("SELECT id, stock FROM merchant_offers WHERE id = $offerId").get({ $offerId: input.offerId });
    if (!offer) throw new Error("The offer is not available.");

    let availableStock = Number(offer.stock);
    if (input.variantId !== undefined) {
      const variant = this.database
        .prepare("SELECT id, stock FROM offer_variants WHERE id = $variantId AND offer_id = $offerId")
        .get({ $variantId: input.variantId, $offerId: input.offerId });
      if (!variant) throw new Error("The variant is not available for this offer.");
      availableStock = Number(variant.stock);
    }

    const existing = this.database
      .prepare("SELECT id, quantity FROM cart_lines WHERE task_id = $taskId AND offer_id = $offerId AND variant_id IS $variantId")
      .get({ $taskId: input.taskId, $offerId: input.offerId, $variantId: input.variantId ?? null });
    const existingQuantity = existing ? Number(existing.quantity) : 0;
    if (existingQuantity + quantity > availableStock) {
      throw new Error("Not enough stock for the requested quantity.");
    }

    const now = this.clock().toISOString();
    if (existing) {
      this.database
        .prepare("UPDATE cart_lines SET quantity = $quantity, updated_at = $updatedAt WHERE id = $id")
        .run({ $quantity: existingQuantity + quantity, $updatedAt: now, $id: existing.id });
      return String(existing.id);
    }

    const id = crypto.randomUUID();
    this.database
      .prepare("INSERT INTO cart_lines (id, task_id, offer_id, variant_id, quantity, created_at, updated_at) VALUES ($id, $taskId, $offerId, $variantId, $quantity, $createdAt, $updatedAt)")
      .run({ $id: id, $taskId: input.taskId, $offerId: input.offerId, $variantId: input.variantId ?? null, $quantity: quantity, $createdAt: now, $updatedAt: now });
    return id;
  }

  changeQuantity(taskId: string, lineId: string, quantity: number): void {
    const safeQuantity = requirePositiveInteger(quantity, "quantity", "Cart line");
    const line = this.database
      .prepare("SELECT id, offer_id, variant_id, quantity FROM cart_lines WHERE task_id = $taskId AND id = $lineId")
      .get({ $taskId: taskId, $lineId: lineId });
    if (!line) throw new Error("The cart line does not exist.");

    const offer = this.database.prepare("SELECT stock FROM merchant_offers WHERE id = $offerId").get({ $offerId: line.offer_id });
    if (!offer) throw new Error("The offer is not available.");
    let availableStock = Number(offer.stock);
    if (line.variant_id !== null && line.variant_id !== undefined) {
      const variant = this.database
        .prepare("SELECT stock FROM offer_variants WHERE id = $variantId AND offer_id = $offerId")
        .get({ $variantId: line.variant_id, $offerId: line.offer_id });
      if (!variant) throw new Error("The variant is not available for this offer.");
      availableStock = Number(variant.stock);
    }
    if (safeQuantity > availableStock) throw new Error("Not enough stock for the requested quantity.");

    this.database
      .prepare("UPDATE cart_lines SET quantity = $quantity, updated_at = $updatedAt WHERE id = $id")
      .run({ $quantity: safeQuantity, $updatedAt: this.clock().toISOString(), $id: lineId });
  }

  removeLine(taskId: string, lineId: string): void {
    this.database.prepare("DELETE FROM cart_lines WHERE task_id = $taskId AND id = $lineId").run({ $taskId: taskId, $lineId: lineId });
  }

  /** AC1/AC2/AC4: groups lines by store and re-reads the current offer price and store/merchant status. */
  cart(taskId: string): MarketplaceCart {
    const rows = this.database
      .prepare(
        `SELECT l.id AS line_id, l.offer_id, l.variant_id, l.quantity,
                o.price_kobo, o.product_id,
                p.name AS product_name,
                s.id AS store_id, s.name AS store_name, s.status AS store_status,
                m.status AS merchant_status
         FROM cart_lines l
         JOIN merchant_offers o ON o.id = l.offer_id
         JOIN products p ON p.id = o.product_id
         JOIN stores s ON s.id = o.store_id
         JOIN merchants m ON m.id = s.merchant_id
         WHERE l.task_id = $taskId
         ORDER BY s.id, l.id`,
      )
      .all({ $taskId: taskId });

    const groups = new Map<string, { readonly storeId: string; readonly storeName: string; lines: CartLine[] }>();
    for (const row of rows) {
      const storeId = String(row.store_id);
      let group = groups.get(storeId);
      if (!group) {
        group = { storeId, storeName: String(row.store_name), lines: [] };
        groups.set(storeId, group);
      }
      group.lines.push(readCartLine(row));
    }

    return { taskId, storeCarts: [...groups.values()].map((group) => ({ storeId: group.storeId, storeName: group.storeName, lines: group.lines })) };
  }
}
