/**
 * A Merchant Order is the purchase contract for one Store checkout, with one seller of record
 * (ADR 0001). Status names and transitions are ported from instastore `set_order_status` and
 * `src/lib/orderWorkflow.ts`.
 */

export type MerchantOrderStatus = "Pending Verification" | "Processing" | "Shipped" | "Fulfilled" | "Cancelled";

export const ORDER_STATUSES: readonly MerchantOrderStatus[] = [
  "Pending Verification",
  "Processing",
  "Shipped",
  "Fulfilled",
  "Cancelled",
];

export const NEXT_ORDER_STATUSES: Readonly<Record<MerchantOrderStatus, readonly MerchantOrderStatus[]>> = {
  "Pending Verification": ["Processing", "Cancelled"],
  Processing: ["Shipped", "Cancelled"],
  Shipped: ["Fulfilled"],
  Fulfilled: [],
  Cancelled: [],
};

export function isMerchantOrderStatus(value: unknown): value is MerchantOrderStatus {
  return (ORDER_STATUSES as readonly unknown[]).includes(value);
}

export interface OrderItem {
  readonly offerId: string;
  readonly variantId?: string;
  readonly productId: string;
  readonly name: string;
  readonly category: string;
  readonly priceKobo: number;
  readonly quantity: number;
}

export interface OrderItemInput {
  readonly offerId: string;
  readonly variantId?: string;
  readonly quantity: number;
}

export interface CreateOrderInput {
  readonly storeId: string;
  readonly deliveryZoneId: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly customerInstagram?: string;
  readonly shippingAddress: Record<string, unknown>;
  readonly items: readonly OrderItemInput[];
  readonly submittedTotalKobo: number;
  readonly paymentReference: string;
}

export interface MerchantOrder {
  readonly id: string;
  readonly storeId: string;
  readonly publicCode: string;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly customerInstagram?: string;
  readonly items: readonly OrderItem[];
  readonly subtotalKobo: number;
  readonly shippingFeeKobo: number;
  readonly totalKobo: number;
  readonly status: MerchantOrderStatus;
  readonly shippingAddress: Record<string, unknown>;
  readonly deliveryZoneId: string;
  readonly deliveryCity?: string;
  readonly deliveryZoneName?: string;
  readonly deliveryProvider?: string;
  readonly deliveryEstimate?: string;
  readonly paymentReference: string;
  readonly paymentVerifiedAt?: string;
  readonly paymentEventId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** instastore `create_store_order`: keep only digits and `+`. */
export function normalizePhone(raw: string): string {
  return raw.replace(/[^0-9+]/g, "");
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return value;
}

function nonBlank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be non-blank`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOrderItem(value: unknown): OrderItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Order item must be an object");
  }
  const record = value as Record<string, unknown>;
  return {
    offerId: nonBlank(record.offerId, "offerId"),
    ...(record.variantId === undefined ? {} : { variantId: nonBlank(record.variantId, "variantId") }),
    productId: nonBlank(record.productId, "productId"),
    name: nonBlank(record.name, "name"),
    category: nonBlank(record.category, "category"),
    priceKobo: nonNegativeInteger(record.priceKobo, "priceKobo"),
    quantity: requirePositiveInteger(record.quantity, "quantity"),
  };
}

/**
 * Boundary guard for an untrusted checkout body (ADR 0099 domain boundary). Rejects any shape the Merchant Order
 * contract cannot represent before the order service sees it; it does not check stock, price or the total.
 */
export function parseCreateOrderInput(value: unknown): CreateOrderInput {
  if (!isRecord(value)) {
    throw new TypeError("Create order input must be an object");
  }
  if (!Array.isArray(value.items) || value.items.length === 0) {
    throw new TypeError("Create order input must have at least one item");
  }
  if (!isRecord(value.shippingAddress) || Object.keys(value.shippingAddress).length === 0) {
    throw new TypeError("Create order input must have a non-empty shipping address");
  }
  return {
    storeId: nonBlank(value.storeId, "storeId"),
    deliveryZoneId: nonBlank(value.deliveryZoneId, "deliveryZoneId"),
    customerName: nonBlank(value.customerName, "customerName"),
    customerPhone: nonBlank(value.customerPhone, "customerPhone"),
    ...(value.customerInstagram === undefined || value.customerInstagram === null ? {} : { customerInstagram: nonBlank(value.customerInstagram, "customerInstagram") }),
    shippingAddress: value.shippingAddress,
    items: value.items.map(parseOrderItemInput),
    submittedTotalKobo: nonNegativeInteger(value.submittedTotalKobo, "submittedTotalKobo"),
    paymentReference: nonBlank(value.paymentReference, "paymentReference"),
  };
}

function parseOrderItemInput(value: unknown): OrderItemInput {
  if (!isRecord(value)) {
    throw new TypeError("Order item input must be an object");
  }
  return {
    offerId: nonBlank(value.offerId, "offerId"),
    ...(value.variantId === undefined ? {} : { variantId: nonBlank(value.variantId, "variantId") }),
    quantity: requirePositiveInteger(value.quantity, "quantity"),
  };
}

export function parseMerchantOrder(value: unknown, label: string): MerchantOrder {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (!isMerchantOrderStatus(record.status)) {
    throw new TypeError(`${label} has an unknown status`);
  }
  if (!Array.isArray(record.items) || record.items.length === 0) {
    throw new TypeError(`${label} must have at least one item`);
  }
  if (!isRecord(record.shippingAddress) || Object.keys(record.shippingAddress).length === 0) {
    throw new TypeError(`${label} must have a non-empty shipping address`);
  }
  return {
    id: nonBlank(record.id, "id"),
    storeId: nonBlank(record.storeId, "storeId"),
    publicCode: nonBlank(record.publicCode, "publicCode"),
    customerName: nonBlank(record.customerName, "customerName"),
    customerPhone: nonBlank(record.customerPhone, "customerPhone"),
    ...(record.customerInstagram === undefined || record.customerInstagram === null ? {} : { customerInstagram: nonBlank(record.customerInstagram, "customerInstagram") }),
    items: record.items.map(parseOrderItem),
    subtotalKobo: nonNegativeInteger(record.subtotalKobo, "subtotalKobo"),
    shippingFeeKobo: nonNegativeInteger(record.shippingFeeKobo, "shippingFeeKobo"),
    totalKobo: nonNegativeInteger(record.totalKobo, "totalKobo"),
    status: record.status,
    shippingAddress: record.shippingAddress,
    deliveryZoneId: nonBlank(record.deliveryZoneId, "deliveryZoneId"),
    ...(record.deliveryCity === undefined || record.deliveryCity === null ? {} : { deliveryCity: nonBlank(record.deliveryCity, "deliveryCity") }),
    ...(record.deliveryZoneName === undefined || record.deliveryZoneName === null ? {} : { deliveryZoneName: nonBlank(record.deliveryZoneName, "deliveryZoneName") }),
    ...(record.deliveryProvider === undefined || record.deliveryProvider === null ? {} : { deliveryProvider: nonBlank(record.deliveryProvider, "deliveryProvider") }),
    ...(record.deliveryEstimate === undefined || record.deliveryEstimate === null ? {} : { deliveryEstimate: nonBlank(record.deliveryEstimate, "deliveryEstimate") }),
    paymentReference: nonBlank(record.paymentReference, "paymentReference"),
    ...(record.paymentVerifiedAt === undefined || record.paymentVerifiedAt === null ? {} : { paymentVerifiedAt: nonBlank(record.paymentVerifiedAt, "paymentVerifiedAt") }),
    ...(record.paymentEventId === undefined || record.paymentEventId === null ? {} : { paymentEventId: nonBlank(record.paymentEventId, "paymentEventId") }),
    createdAt: nonBlank(record.createdAt, "createdAt"),
    updatedAt: nonBlank(record.updatedAt, "updatedAt"),
  };
}
