# Marketplace Commerce

A future Concierge Platform domain in which independent Nigerian merchants publish product offers and consumers purchase them through merchant-scoped orders.

## Participants

**Merchant**:
A verified Nigerian business that sells goods through one or more stores and remains the seller of record for its merchant orders.
_Avoid_: Seller, vendor

**Consumer**:
A person who discovers and purchases merchant offers through the marketplace.
_Avoid_: Customer, buyer, guest

**Store**:
A merchant's public trading presence in the marketplace. A merchant may operate multiple stores.
_Avoid_: Merchant, storefront

## Catalogue

**Product**:
The shared identity and descriptive facts of an item, independent of who sells it.
_Avoid_: Listing, offer

**Merchant Offer**:
A store-specific, purchasable proposition for a product or variant, including its price, inventory, condition, and fulfilment terms.
_Avoid_: Product, listing

## Purchasing

**Marketplace Cart**:
A consumer's collection of merchant offers, grouped into store carts and not itself a checkout boundary.
_Avoid_: Basket, order

**Store Cart**:
The portion of a marketplace cart containing offers from exactly one store.
_Avoid_: Subcart, merchant cart

**Merchant Order**:
The purchase contract for one store checkout, with one seller of record, payment, fulfilment obligation, and refund boundary.
_Avoid_: Suborder, store order

**Seller of Record**:
The merchant contractually selling and responsible for the goods in a merchant order.
_Avoid_: Platform

**Marketplace Commission**:
The platform's fee earned on a merchant order.
_Avoid_: Merchant revenue
