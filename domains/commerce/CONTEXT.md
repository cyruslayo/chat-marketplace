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

## Order tracking

**Public Order Code**:
The identifier printed for a Merchant Order, shown to the Consumer and used with the phone number to track it.
_Avoid_: Order number, tracking number

**Tracking Lock**:
The state in which tracking for one Public Order Code refuses every lookup. A Tracking Lock starts after five wrong-phone attempts within fifteen minutes of the first failure, lasts for the rest of that window, and answers exactly like a wrong phone so that it reveals nothing.
_Avoid_: Ban, block

**Nigerian Mobile Number**:
A Consumer phone number in one canonical form, `+234` followed by the ten-digit national number. A local number (`0801…`), an international number (`+234…`, `234…`) or a `00234…` number with a Nigerian mobile prefix (070, 080, 081, 090, 091) is the same number. Other numbers keep their digits and plus.
_Avoid_: Phone format

_Decision (user, 18 Oct 2026, issue 27)_: the Tracking Lock limits (5 wrong-phone attempts, 15 minutes) and the Nigerian Mobile Number rule above are the user's decisions. The limits are configurable options with these defaults; the mobile prefix list is a coordinator recommendation awaiting user confirmation.
