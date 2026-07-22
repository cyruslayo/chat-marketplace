# Nigeria launch payments use one store checkout at a time

---
status: deprecated
---

The Nigerian launch uses NGN store-level checkouts: one merchant order creates one payment that is split between that merchant's settlement subaccount and the platform's commission. Paystack is the primary provider behind an internal payment-provider boundary, with cards, bank transfer, and USSD treated as asynchronous methods; paid order state requires a verified provider result rather than a client callback. This deliberately postpones cross-store checkout so that each payment, seller, fulfilment obligation, refund, and dispute has the same boundary.

This decision is conditional on written provider confirmation of the marketplace structure and Nigerian legal review. Only verified, CAC-registered merchants with active payment accounts may receive paid orders, and the platform maintains its own ledger rather than treating provider settlement data as its financial source of truth.

This is no longer a launch decision because ADR-0003 changed the reference product from marketplace commerce to shortlet booking. It remains historical input for a future commerce domain and must be revalidated before implementation.
