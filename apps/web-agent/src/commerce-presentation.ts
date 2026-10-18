import { type A2UIComponent, type A2UIServerMessage } from "@cylayo/weaver-core";
import { COMMERCE_CART_CATALOG_ID, COMMERCE_DISCOVERY_CATALOG_ID, COMMERCE_ORDER_CATALOG_ID } from "./commerce-catalogs.js";
import { formatMoney, formatWatDateTime } from "../../web/src/ui-kit.js";
import { COMMERCE_GUEST_COPY, commerceSoldBy } from "./guest-content.js";
export const COMMERCE_CHECKOUT_CONFIRM_ACTION = "commerce.checkout.confirm";

/** Technical interaction budgets; IDs and authoritative numeric facts are never truncated. */
export interface CommerceProjectionLimits {
  readonly maxResults: number;
  readonly maxTextCodePoints: number;
}

/** Defaults cap prompt/UI payload size and are not commerce policy thresholds. */
export const DEFAULT_COMMERCE_PROJECTION_LIMITS: CommerceProjectionLimits = Object.freeze({ maxResults: 12, maxTextCodePoints: 240 });

export function validateCommerceProjectionLimits(limits: CommerceProjectionLimits): CommerceProjectionLimits {
  if (!Number.isSafeInteger(limits.maxResults) || limits.maxResults <= 0 || !Number.isSafeInteger(limits.maxTextCodePoints) || limits.maxTextCodePoints <= 0) {
    throw new RangeError("Commerce projection limits must be positive safe integers.");
  }
  return Object.freeze({ ...limits });
}

/** Bounds untrusted display text by Unicode code point and inserts wrap opportunities in long words. */
export function projectCommerceText(value: string, limits: CommerceProjectionLimits = DEFAULT_COMMERCE_PROJECTION_LIMITS): string {
  const validLimits = validateCommerceProjectionLimits(limits);
  const normalized = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/gu, " ").trim();
  let result = "";
  let run = 0;
  let count = 0;
  for (const point of normalized) {
    if (count >= validLimits.maxTextCodePoints) break;
    result += point;
    count += 1;
    run = /\s/u.test(point) ? 0 : run + 1;
    if (run >= 32 && count < validLimits.maxTextCodePoints) {
      result += "\u200b";
      count += 1;
      run = 0;
    }
  }
  return result.trimEnd();
}

export interface CommerceOfferPresentation {
  readonly offerId: string;
  /** The Store and its verified Merchant identify the seller of record (ADR 0001); chat and pages render these same facts. */
  readonly storeName: string;
  readonly merchantName: string;
  readonly productName: string;
  readonly category: string;
  readonly description: string;
  readonly priceKobo: number;
  readonly stock: number;
}

export interface CommerceCartPresentation {
  readonly storeId: string;
  readonly storeName: string;
  readonly lines: readonly { readonly productName: string; readonly quantity: number; readonly priceKobo: number }[];
}

export interface CommerceOrderPresentation {
  readonly publicCode: string;
  readonly status: string;
  readonly updatedAt: string;
}

/** Every checkout proposal status the command path can store or project (ADR 0103). */
export type CommerceCheckoutStatus = "proposed" | "dispatching" | "payment_unavailable" | "payment_started";
type NonProposedCheckoutStatus = Exclude<CommerceCheckoutStatus, "proposed">;

export interface CommerceCheckoutPresentation {
  readonly proposalId: string;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly cartVersion: string;
  readonly storeName: string;
  readonly lines: readonly { readonly productName: string; readonly quantity: number; readonly priceKobo: number }[];
  readonly subtotalKobo: number;
  readonly shippingFeeKobo: number;
  readonly totalKobo: number;
  readonly status: CommerceCheckoutStatus;
}

export function commerceDiscoveryPresentation(offers: readonly CommerceOfferPresentation[], limits = DEFAULT_COMMERCE_PROJECTION_LIMITS) {
  const bounded = validateCommerceProjectionLimits(limits);
  return { title: "Products", offers: offers.slice(0, bounded.maxResults).map((offer) => ({ offerId: offer.offerId, productName: projectCommerceText(offer.productName, bounded), category: projectCommerceText(offer.category, bounded), description: projectCommerceText(offer.description, bounded), priceKobo: offer.priceKobo, stock: offer.stock, storeName: projectCommerceText(offer.storeName, bounded), merchantName: projectCommerceText(offer.merchantName, bounded) })) };
}

export function commerceCartPresentation(cart: CommerceCartPresentation, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS) {
  const bounded = validateCommerceProjectionLimits(limits);
  return { title: projectCommerceText(cart.storeName, bounded), storeId: cart.storeId, lines: cart.lines.slice(0, bounded.maxResults).map((line) => ({ productName: projectCommerceText(line.productName, bounded), quantity: line.quantity, priceKobo: line.priceKobo })) };
}

export function commerceOrderPresentation(order: CommerceOrderPresentation, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS) {
  return { title: COMMERCE_GUEST_COPY.orderStatusTitle, publicCode: order.publicCode, status: projectCommerceText(order.status, limits), updatedAt: projectCommerceText(order.updatedAt, limits) };
}

export function commerceCheckoutPresentation(checkout: CommerceCheckoutPresentation, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS) {
  const bounded = validateCommerceProjectionLimits(limits);
  return { proposalId: checkout.proposalId, taskId: checkout.taskId, expectedVersion: checkout.expectedVersion, cartVersion: checkout.cartVersion, storeName: projectCommerceText(checkout.storeName, bounded), lines: checkout.lines.slice(0, bounded.maxResults).map((line) => ({ productName: projectCommerceText(line.productName, bounded), quantity: line.quantity, priceKobo: line.priceKobo })), subtotalKobo: checkout.subtotalKobo, shippingFeeKobo: checkout.shippingFeeKobo, totalKobo: checkout.totalKobo, status: checkout.status };
}

function messages(surfaceId: string, catalogId: string, title: string, lines: readonly string[]): readonly A2UIServerMessage[] {
  // Weaver resolves the A2UI tree from the protocol's canonical root component ID.
  const components: A2UIComponent[] = [{ id: "root", component: "Column", children: ["commerce-title", ...lines.map((_, i) => `commerce-line-${i}`)] }, { id: "commerce-title", component: "Text", text: title, variant: "h2" }, ...lines.map((text, i) => ({ id: `commerce-line-${i}`, component: "Text" as const, text }))];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}

export function commerceDiscoverySurface(artifact: unknown, surfaceId: string, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS): readonly unknown[] {
  const offers = Array.isArray(artifact) ? artifact as CommerceOfferPresentation[] : [];
  const presentation = commerceDiscoveryPresentation(offers, limits);
  return messages(surfaceId, COMMERCE_DISCOVERY_CATALOG_ID, presentation.title, presentation.offers.map((offer) => `${offer.productName} · ${offer.category} · ${formatMoney(offer.priceKobo)} · ${offer.stock} ${COMMERCE_GUEST_COPY.available}\n${commerceSoldBy(offer.merchantName, offer.storeName)}\n${offer.description}`));
}

export function commerceCartSurface(cart: CommerceCartPresentation, surfaceId: string, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS): readonly unknown[] {
  const presentation = commerceCartPresentation(cart, limits);
  return messages(surfaceId, COMMERCE_CART_CATALOG_ID, presentation.title, presentation.lines.map((line) => `${line.productName} · ${line.quantity} × ${formatMoney(line.priceKobo)}`));
}

export function commerceOrderSurface(order: CommerceOrderPresentation, surfaceId: string, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS): readonly unknown[] {
  const presentation = commerceOrderPresentation(order, limits);
  return messages(surfaceId, COMMERCE_ORDER_CATALOG_ID, presentation.title, [`${presentation.publicCode} · ${presentation.status} · ${formatWatDateTime(presentation.updatedAt)}`]);
}

/** Guest copy for each non-proposed checkout status. Every string already exists in the commerce runtime; none is new copy. */
export const COMMERCE_CHECKOUT_STATUS_COPY: Record<NonProposedCheckoutStatus, string> = Object.freeze({
  payment_unavailable: "Payment unavailable. No order or payment was created.",
  payment_started: "The platform accepted the payment-start command.",
  dispatching: "This checkout command is already being processed.",
});

function checkoutStatusCopy(status: NonProposedCheckoutStatus): string {
  // The type covers compile-time callers only; a value read from storage can still arrive here at runtime, so keep the guard.
  if (!Object.hasOwn(COMMERCE_CHECKOUT_STATUS_COPY, status)) throw new RangeError("Checkout status has no approved copy.");
  return COMMERCE_CHECKOUT_STATUS_COPY[status];
}

export function commerceCheckoutSurface(checkout: CommerceCheckoutPresentation, surfaceId: string, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS): readonly unknown[] {
  const presentation = commerceCheckoutPresentation(checkout, limits);
  const lines = presentation.lines.map((line, index) => ({ id: `checkout-line-${index}`, component: "Text" as const, text: `${line.productName} · ${line.quantity} × ${formatMoney(line.priceKobo)}` }));
  // The confirmation controls are built once and the root's child list is derived from the same array, so a status-dependent
  // component can never be referenced while absent (the post-confirm surface emits no confirm label).
  const confirmation: A2UIComponent[] = presentation.status === "proposed"
    ? [{ id: "checkout-confirm", component: "Button" as const, child: "checkout-confirm-label", variant: "primary" as const, action: { event: { name: COMMERCE_CHECKOUT_CONFIRM_ACTION, context: { proposalId: presentation.proposalId, taskId: presentation.taskId, expectedVersion: presentation.expectedVersion, cartVersion: presentation.cartVersion, confirmedTotalKobo: presentation.totalKobo, surfaceId } } }, accessibility: { label: `Confirm checkout total ${formatMoney(presentation.totalKobo)}` } }]
    : [{ id: "checkout-confirm", component: "Text" as const, text: checkoutStatusCopy(presentation.status) }];
  // The button references this label through `child`; it is emitted but is not a root child, or the text would render twice.
  const confirmLabels: A2UIComponent[] = presentation.status === "proposed" ? [{ id: "checkout-confirm-label", component: "Text" as const, text: "Confirm checkout" }] : [];
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["checkout-title", ...lines.map((line) => line.id), "checkout-subtotal", "checkout-delivery", "checkout-total", ...confirmation.map((component) => component.id)] },
    { id: "checkout-title", component: "Text", text: `Checkout · ${presentation.storeName}`, variant: "h2" },
    ...lines,
    { id: "checkout-subtotal", component: "Text", text: `Subtotal: ${formatMoney(presentation.subtotalKobo)}` },
    { id: "checkout-delivery", component: "Text", text: `Delivery: ${formatMoney(presentation.shippingFeeKobo)}` },
    { id: "checkout-total", component: "Text", text: `Total: ${formatMoney(presentation.totalKobo)}` },
    ...confirmation,
    ...confirmLabels,
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: COMMERCE_CART_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
