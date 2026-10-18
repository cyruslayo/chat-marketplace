import { type A2UIComponent, type A2UIServerMessage } from "@cylayo/weaver-core";
import { COMMERCE_CART_CATALOG_ID, COMMERCE_DISCOVERY_CATALOG_ID, COMMERCE_ORDER_CATALOG_ID } from "./commerce-catalogs.js";
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
  readonly status: string;
}

export function commerceDiscoveryPresentation(offers: readonly CommerceOfferPresentation[], limits = DEFAULT_COMMERCE_PROJECTION_LIMITS) {
  const bounded = validateCommerceProjectionLimits(limits);
  return { title: "Products", offers: offers.slice(0, bounded.maxResults).map((offer) => ({ offerId: offer.offerId, productName: projectCommerceText(offer.productName, bounded), category: projectCommerceText(offer.category, bounded), description: projectCommerceText(offer.description, bounded), priceKobo: offer.priceKobo, stock: offer.stock })) };
}

export function commerceCartPresentation(cart: CommerceCartPresentation, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS) {
  const bounded = validateCommerceProjectionLimits(limits);
  return { title: projectCommerceText(cart.storeName, bounded), storeId: cart.storeId, lines: cart.lines.slice(0, bounded.maxResults).map((line) => ({ productName: projectCommerceText(line.productName, bounded), quantity: line.quantity, priceKobo: line.priceKobo })) };
}

export function commerceOrderPresentation(order: CommerceOrderPresentation, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS) {
  return { title: "Order status", publicCode: order.publicCode, status: projectCommerceText(order.status, limits), updatedAt: projectCommerceText(order.updatedAt, limits) };
}

export function commerceCheckoutPresentation(checkout: CommerceCheckoutPresentation, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS) {
  const bounded = validateCommerceProjectionLimits(limits);
  return { proposalId: checkout.proposalId, taskId: checkout.taskId, expectedVersion: checkout.expectedVersion, cartVersion: checkout.cartVersion, storeName: projectCommerceText(checkout.storeName, bounded), lines: checkout.lines.slice(0, bounded.maxResults).map((line) => ({ productName: projectCommerceText(line.productName, bounded), quantity: line.quantity, priceKobo: line.priceKobo })), subtotalKobo: checkout.subtotalKobo, shippingFeeKobo: checkout.shippingFeeKobo, totalKobo: checkout.totalKobo, status: projectCommerceText(checkout.status, bounded) };
}

function messages(surfaceId: string, catalogId: string, title: string, lines: readonly string[]): readonly A2UIServerMessage[] {
  const components: A2UIComponent[] = [{ id: "commerce-root", component: "Column", children: ["commerce-title", ...lines.map((_, i) => `commerce-line-${i}`)] }, { id: "commerce-title", component: "Text", text: title, variant: "h2" }, ...lines.map((text, i) => ({ id: `commerce-line-${i}`, component: "Text" as const, text }))];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}

export function commerceDiscoverySurface(artifact: unknown, surfaceId: string, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS): readonly unknown[] {
  const offers = Array.isArray(artifact) ? artifact as CommerceOfferPresentation[] : [];
  const presentation = commerceDiscoveryPresentation(offers, limits);
  return messages(surfaceId, COMMERCE_DISCOVERY_CATALOG_ID, presentation.title, presentation.offers.map((offer) => `${offer.productName} · ${offer.category} · NGN ${(offer.priceKobo / 100).toLocaleString("en-NG")} · ${offer.stock} available\n${offer.description}`));
}

export function commerceCartSurface(cart: CommerceCartPresentation, surfaceId: string, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS): readonly unknown[] {
  const presentation = commerceCartPresentation(cart, limits);
  return messages(surfaceId, COMMERCE_CART_CATALOG_ID, presentation.title, presentation.lines.map((line) => `${line.productName} · ${line.quantity} × NGN ${(line.priceKobo / 100).toLocaleString("en-NG")}`));
}

export function commerceOrderSurface(order: CommerceOrderPresentation, surfaceId: string, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS): readonly unknown[] {
  const presentation = commerceOrderPresentation(order, limits);
  return messages(surfaceId, COMMERCE_ORDER_CATALOG_ID, presentation.title, [`${presentation.publicCode} · ${presentation.status} · ${presentation.updatedAt}`]);
}

export function commerceCheckoutSurface(checkout: CommerceCheckoutPresentation, surfaceId: string, limits = DEFAULT_COMMERCE_PROJECTION_LIMITS): readonly unknown[] {
  const presentation = commerceCheckoutPresentation(checkout, limits);
  const lines = presentation.lines.map((line, index) => ({ id: `checkout-line-${index}`, component: "Text" as const, text: `${line.productName} · ${line.quantity} × NGN ${(line.priceKobo / 100).toLocaleString("en-NG")}` }));
  const components: A2UIComponent[] = [
    { id: "checkout-root", component: "Column", children: ["checkout-title", ...lines.map((line) => line.id), "checkout-subtotal", "checkout-delivery", "checkout-total", "checkout-confirm", "checkout-confirm-label"] },
    { id: "checkout-title", component: "Text", text: `Checkout · ${presentation.storeName}`, variant: "h2" },
    ...lines,
    { id: "checkout-subtotal", component: "Text", text: `Subtotal: NGN ${(presentation.subtotalKobo / 100).toLocaleString("en-NG")}` },
    { id: "checkout-delivery", component: "Text", text: `Delivery: NGN ${(presentation.shippingFeeKobo / 100).toLocaleString("en-NG")}` },
    { id: "checkout-total", component: "Text", text: `Total: NGN ${(presentation.totalKobo / 100).toLocaleString("en-NG")}` },
    ...(presentation.status === "proposed" ? [{ id: "checkout-confirm", component: "Button" as const, child: "checkout-confirm-label", variant: "primary" as const, action: { event: { name: COMMERCE_CHECKOUT_CONFIRM_ACTION, context: { proposalId: presentation.proposalId, taskId: presentation.taskId, expectedVersion: presentation.expectedVersion, cartVersion: presentation.cartVersion, confirmedTotalKobo: presentation.totalKobo, surfaceId } } }, accessibility: { label: `Confirm checkout total NGN ${(presentation.totalKobo / 100).toLocaleString("en-NG")}` } }, { id: "checkout-confirm-label", component: "Text" as const, text: "Confirm checkout" }] : [{ id: "checkout-confirm", component: "Text" as const, text: "Payment unavailable. No order or payment was created." }]),
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: COMMERCE_CART_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
