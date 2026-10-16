import type { Store } from "./store.js";
import type { OfferSearchResult } from "./commerce-catalogue.js";
import { CommerceCatalogue } from "./commerce-catalogue.js";
import { CommerceDirectory } from "./commerce-directory.js";
import { CommerceOrders } from "./commerce-order.js";
import { NEXT_ORDER_STATUSES, type MerchantOrder, type MerchantOrderStatus } from "./order.js";

/**
 * The merchant back office's authorization boundary (slices 25a/25b). A merchant principal acts only on
 * its own stores; an operator principal alone verifies merchants. Reads return live rows, so an edit is
 * immediately visible to consumer search (AC3).
 */
export type MerchantBackOfficeRole = "merchant" | "operator";

export interface MerchantBackOfficePrincipal {
  readonly id: string;
  readonly role: MerchantBackOfficeRole;
}

export class MerchantBackOffice {
  constructor(
    private readonly directory: CommerceDirectory,
    private readonly catalogue: CommerceCatalogue,
    private readonly orders: CommerceOrders,
  ) {}

  merchantStores(principal: MerchantBackOfficePrincipal): readonly Store[] {
    if (principal.role !== "merchant") return [];
    return this.directory.storesOfMerchant(principal.id);
  }

  /** 25a AC1: a merchant sees only its own store's catalogue. */
  merchantCatalogue(principal: MerchantBackOfficePrincipal, storeId: string): readonly OfferSearchResult[] {
    this.#assertMerchantOwnsStore(principal, storeId);
    return this.catalogue.offersForStore(storeId);
  }

  /** 25a AC1: a merchant edits only its own store's catalogue. */
  updateOfferPrice(principal: MerchantBackOfficePrincipal, storeId: string, offerId: string, priceKobo: number): void {
    this.#assertMerchantOwnsStore(principal, storeId);
    const belongs = this.catalogue.offersForStore(storeId).some((offer) => offer.offerId === offerId);
    if (!belongs) throw new Error("The offer is not in this store's catalogue.");
    this.catalogue.updateOfferPrice(offerId, priceKobo);
  }

  /** 25a AC2: only an operator marks a merchant verified. */
  markMerchantVerified(principal: MerchantBackOfficePrincipal, merchantId: string): void {
    if (principal.role !== "operator") throw new Error("Only an operator can verify a merchant.");
    this.directory.updateMerchantStatus(merchantId, "verified");
  }

  /** 25b AC1: a merchant acts only on its own store's orders. */
  merchantOrders(principal: MerchantBackOfficePrincipal, storeId: string): readonly MerchantOrder[] {
    this.#assertMerchantOwnsStore(principal, storeId);
    return this.orders.ordersForStore(storeId);
  }

  /** 25b AC2: only allowed status transitions are accepted. */
  transitionOrder(principal: MerchantBackOfficePrincipal, orderId: string, status: MerchantOrderStatus): MerchantOrder {
    if (principal.role !== "merchant") throw new Error("Merchant principal required.");
    const order = this.orders.orderById(orderId);
    if (!order) throw new Error("Order not found.");
    this.#assertMerchantOwnsStore(principal, order.storeId);
    return this.orders.transitionStatus(orderId, status);
  }

  /** 25b AC2: the statuses offered from a status. */
  nextOrderStatuses(status: MerchantOrderStatus): readonly MerchantOrderStatus[] {
    return NEXT_ORDER_STATUSES[status];
  }

  #assertMerchantOwnsStore(principal: MerchantBackOfficePrincipal, storeId: string): void {
    if (principal.role !== "merchant") throw new Error("Merchant principal required.");
    const store = this.directory.storeById(storeId);
    if (!store || store.merchantId !== principal.id) throw new Error("Store not found for this merchant.");
  }
}
