import { createHash } from "node:crypto";
import type { SqlDatabase, SqlRow } from "../../../packages/platform-core/src/sql-database.js";
import {
  NEXT_ORDER_STATUSES,
  isMerchantOrderStatus,
  normalizePhone,
  parseMerchantOrder,
  type CreateOrderInput,
  type MerchantOrder,
  type MerchantOrderStatus,
  type OrderItem,
} from "./order.js";

function readOrder(row: SqlRow): MerchantOrder {
  return parseMerchantOrder(
    {
      id: row.id,
      storeId: row.store_id,
      publicCode: row.public_code,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerInstagram: row.customer_instagram,
      items: JSON.parse(String(row.items_json)),
      subtotalKobo: row.subtotal_kobo,
      shippingFeeKobo: row.shipping_fee_kobo,
      totalKobo: row.total_kobo,
      status: row.status,
      shippingAddress: JSON.parse(String(row.shipping_address_json)),
      deliveryZoneId: row.delivery_zone_id,
      deliveryCity: row.delivery_city,
      deliveryZoneName: row.delivery_zone_name,
      deliveryProvider: row.delivery_provider,
      deliveryEstimate: row.delivery_estimate,
      paymentVerifiedAt: row.payment_verified_at,
      paymentEventId: row.payment_event_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    "Stored Merchant Order",
  );
}

/**
 * The Merchant Order repository: port of instastore `create_store_order` and `set_order_status`
 * (0017_payment_verification_fact.sql) onto the commerce Product/Offer/Variant model.
 */
/**
 * Issue 24 decision 7: the idempotency key is the SHA-256 of the trimmed payment reference (the normalisation). The raw
 * reference is used only to compute it and is never written, returned or logged.
 */
export function hashPaymentReference(paymentReference: string): string {
  return createHash("sha256").update(paymentReference.trim()).digest("hex");
}

export class CommerceOrders {
  /** The merchant_orders table comes only from the migration ledger (issue 24 review 3); this constructor creates nothing. */
  constructor(private readonly database: SqlDatabase, private readonly clock: () => Date) {}

  /**
   * Validates a checkout against the Store, Offer, zone, stock and total rules without reserving stock or writing an
   * order. The internal checkout route uses it while payment is unavailable; createOrder runs the same rules.
   */
  quoteCheckout(input: CreateOrderInput): void {
    this.#buildOrder(input, this.#requirePhone(input), false);
  }

  createOrder(input: CreateOrderInput): MerchantOrder {
    const normalizedPhone = this.#requirePhone(input);

    // Idempotency on the payment reference hash, before any stock mutation.
    const paymentReferenceHash = hashPaymentReference(input.paymentReference);
    const existing = this.database
      .prepare("SELECT * FROM merchant_orders WHERE payment_reference_hash = $paymentReferenceHash")
      .get({ $paymentReferenceHash: paymentReferenceHash });
    if (existing) {
      if (String(existing.customer_phone) === normalizedPhone) return readOrder(existing);
      throw new Error("This payment reference has already been used.");
    }

    return this.database.transaction(() => {
      const order = this.#buildOrder(input, normalizedPhone, true);
      this.database
        .prepare(
          `INSERT INTO merchant_orders (
             id, store_id, public_code, customer_name, customer_phone, customer_instagram,
             items_json, subtotal_kobo, shipping_fee_kobo, total_kobo, status, shipping_address_json,
             delivery_zone_id, delivery_city, delivery_zone_name, delivery_provider, delivery_estimate,
             payment_reference_hash, created_at, updated_at
           ) VALUES (
             $id, $storeId, $publicCode, $customerName, $customerPhone, $customerInstagram,
             $itemsJson, $subtotalKobo, $shippingFeeKobo, $totalKobo, $status, $shippingAddressJson,
             $deliveryZoneId, $deliveryCity, $deliveryZoneName, $deliveryProvider, $deliveryEstimate,
             $paymentReferenceHash, $createdAt, $updatedAt
           )`,
        )
        .run({
          $id: order.id,
          $storeId: order.storeId,
          $publicCode: order.publicCode,
          $customerName: order.customerName,
          $customerPhone: order.customerPhone,
          $customerInstagram: order.customerInstagram ?? null,
          $itemsJson: JSON.stringify(order.items),
          $subtotalKobo: order.subtotalKobo,
          $shippingFeeKobo: order.shippingFeeKobo,
          $totalKobo: order.totalKobo,
          $status: order.status,
          $shippingAddressJson: JSON.stringify(order.shippingAddress),
          $deliveryZoneId: order.deliveryZoneId,
          $deliveryCity: order.deliveryCity ?? null,
          $deliveryZoneName: order.deliveryZoneName ?? null,
          $deliveryProvider: order.deliveryProvider ?? null,
          $deliveryEstimate: order.deliveryEstimate ?? null,
          $paymentReferenceHash: paymentReferenceHash,
          $createdAt: order.createdAt,
          $updatedAt: order.updatedAt,
        });
      return order;
    });
  }

  transitionStatus(orderId: string, status: MerchantOrderStatus): MerchantOrder {
    if (!isMerchantOrderStatus(status)) throw new Error("Invalid order status.");
    return this.database.transaction(() => {
      const row = this.database.prepare("SELECT * FROM merchant_orders WHERE id = $id").get({ $id: orderId });
      if (!row) throw new Error("Order not found.");
      const order = readOrder(row);
      if (order.status === status) return order;
      if (!NEXT_ORDER_STATUSES[order.status].includes(status)) {
        throw new Error(`Invalid order status transition from ${order.status} to ${status}`);
      }

      const now = this.clock().toISOString();
      if (status === "Cancelled") {
        for (const item of order.items) this.#restock(item);
        this.database
          .prepare("UPDATE merchant_orders SET status = $status, inventory_restocked = 1, updated_at = $updatedAt WHERE id = $id")
          .run({ $status: status, $updatedAt: now, $id: orderId });
      } else if (order.status === "Pending Verification" && status === "Processing") {
        // First trusted payment verification: coalesce keeps the original fact (AC5).
        const paymentVerifiedAt = order.paymentVerifiedAt ?? now;
        const paymentEventId = order.paymentEventId ?? crypto.randomUUID();
        this.database
          .prepare("UPDATE merchant_orders SET status = $status, payment_verified_at = $paymentVerifiedAt, payment_event_id = $paymentEventId, updated_at = $updatedAt WHERE id = $id")
          .run({ $status: status, $paymentVerifiedAt: paymentVerifiedAt, $paymentEventId: paymentEventId, $updatedAt: now, $id: orderId });
      } else {
        this.database
          .prepare("UPDATE merchant_orders SET status = $status, updated_at = $updatedAt WHERE id = $id")
          .run({ $status: status, $updatedAt: now, $id: orderId });
      }
      return this.orderById(orderId)!;
    });
  }

  orderById(id: string): MerchantOrder | null {
    const row = this.database.prepare("SELECT * FROM merchant_orders WHERE id = $id").get({ $id: id });
    return row ? readOrder(row) : null;
  }

  orderByPublicCode(publicCode: string): MerchantOrder | null {
    const row = this.database.prepare("SELECT * FROM merchant_orders WHERE public_code = $publicCode").get({ $publicCode: publicCode });
    return row ? readOrder(row) : null;
  }

  ordersForStore(storeId: string): readonly MerchantOrder[] {
    return this.database
      .prepare("SELECT * FROM merchant_orders WHERE store_id = $storeId ORDER BY created_at")
      .all({ $storeId: storeId })
      .map(readOrder);
  }

  #requirePhone(input: CreateOrderInput): string {
    const normalizedPhone = normalizePhone(input.customerPhone);
    if (normalizedPhone.length < 7) throw new Error("A valid phone number is required.");
    return normalizedPhone;
  }

  /** Shared checkout rules. Stock is decremented only when `reserveStock` is true, so a quote never mutates stock. */
  #buildOrder(input: CreateOrderInput, normalizedPhone: string, reserveStock: boolean): MerchantOrder {
    // ADR 0100 / ADR 0001: a store takes orders only while it is active AND its merchant is verified, the same
    // visibility rule the catalogue and directory apply. A refusal uses the generic message so it reveals no merchant state.
    const store = this.database
      .prepare(
        `SELECT s.id, s.status AS store_status, m.status AS merchant_status
         FROM stores s JOIN merchants m ON m.id = s.merchant_id WHERE s.id = $id`,
      )
      .get({ $id: input.storeId });
    if (!store || store.store_status !== "active" || store.merchant_status !== "verified") throw new Error("The store is unavailable.");

    const zone = this.database.prepare("SELECT * FROM delivery_zones WHERE id = $id").get({ $id: input.deliveryZoneId });
    if (!zone) throw new Error("The delivery zone is unavailable.");
    if (String(zone.store_id) !== input.storeId) throw new Error("The delivery zone does not belong to this store.");
    if (zone.is_active !== 1) throw new Error("The delivery zone is unavailable.");

    const customerName = input.customerName.trim();
    if (customerName === "") throw new Error("Customer name is required.");
    if (
      typeof input.shippingAddress !== "object" || input.shippingAddress === null || Array.isArray(input.shippingAddress) ||
      Object.keys(input.shippingAddress).length === 0
    ) {
      throw new Error("Shipping address is required.");
    }
    if (input.items.length === 0) throw new Error("At least one item is required.");

    const seen = new Set<string>();
    const trustedItems: OrderItem[] = [];
    let subtotalKobo = 0;
    for (const item of input.items) {
      const quantity = item.quantity;
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
        throw new TypeError("quantity must be a positive integer");
      }
      const key = `${item.offerId}\u0000${item.variantId ?? ""}`;
      if (seen.has(key)) throw new Error("Duplicate products are not allowed.");
      seen.add(key);

      const offer = this.database
        .prepare(
          `SELECT o.id AS offer_id, o.store_id, o.price_kobo, o.stock, p.id AS product_id, p.name, p.category
           FROM merchant_offers o JOIN products p ON p.id = o.product_id
           WHERE o.id = $offerId`,
        )
        .get({ $offerId: item.offerId });
      if (!offer || String(offer.store_id) !== input.storeId) throw new Error("The offer is unavailable for this store.");

      let availableStock = Number(offer.stock);
      if (item.variantId !== undefined) {
        const variant = this.database
          .prepare("SELECT id, stock FROM offer_variants WHERE id = $variantId AND offer_id = $offerId")
          .get({ $variantId: item.variantId, $offerId: item.offerId });
        if (!variant) throw new Error("The variant is unavailable for this offer.");
        availableStock = Number(variant.stock);
      }
      if (availableStock < quantity) throw new Error("Insufficient stock.");

      if (reserveStock) {
        if (item.variantId !== undefined) {
          this.database.prepare("UPDATE offer_variants SET stock = stock - $quantity WHERE id = $variantId").run({ $quantity: quantity, $variantId: item.variantId });
        } else {
          this.database.prepare("UPDATE merchant_offers SET stock = stock - $quantity WHERE id = $offerId").run({ $quantity: quantity, $offerId: item.offerId });
        }
      }

      const priceKobo = Number(offer.price_kobo);
      subtotalKobo += priceKobo * quantity;
      trustedItems.push({
        offerId: item.offerId,
        ...(item.variantId === undefined ? {} : { variantId: item.variantId }),
        productId: String(offer.product_id),
        name: String(offer.name),
        category: String(offer.category),
        priceKobo,
        quantity,
      });
    }

    const shippingFeeKobo = Number(zone.fee_kobo);
    const totalKobo = subtotalKobo + shippingFeeKobo;
    if (input.submittedTotalKobo !== totalKobo) throw new Error("Submitted total does not match current prices.");

    const now = this.clock().toISOString();
    return {
      id: crypto.randomUUID(),
      storeId: input.storeId,
      publicCode: `ORD-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`,
      customerName,
      customerPhone: normalizedPhone,
      ...(input.customerInstagram === undefined || input.customerInstagram.trim() === "" ? {} : { customerInstagram: input.customerInstagram.trim() }),
      items: trustedItems,
      subtotalKobo,
      shippingFeeKobo,
      totalKobo,
      status: "Pending Verification",
      shippingAddress: input.shippingAddress,
      deliveryZoneId: input.deliveryZoneId,
      deliveryCity: zone.city === null || zone.city === undefined ? undefined : String(zone.city),
      deliveryZoneName: zone.name === null || zone.name === undefined ? undefined : String(zone.name),
      deliveryProvider: zone.provider === null || zone.provider === undefined ? undefined : String(zone.provider),
      deliveryEstimate: zone.estimate === null || zone.estimate === undefined ? undefined : String(zone.estimate),
      createdAt: now,
      updatedAt: now,
    };
  }

  #restock(item: OrderItem): void {
    if (item.variantId !== undefined) {
      this.database.prepare("UPDATE offer_variants SET stock = stock + $quantity WHERE id = $variantId").run({ $quantity: item.quantity, $variantId: item.variantId });
    } else {
      this.database.prepare("UPDATE merchant_offers SET stock = stock + $quantity WHERE id = $offerId").run({ $quantity: item.quantity, $offerId: item.offerId });
    }
  }
}
