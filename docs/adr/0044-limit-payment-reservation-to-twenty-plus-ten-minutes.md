# Limit payment reservation to twenty plus ten minutes

Operator confirmation opens one 20-minute Payment Window with an exclusive inventory block and designated PSP transaction. No new attempt, channel switch, reference, transfer instruction, or checkout reopening may begin after the deadline. A reminder occurs at 15 minutes. Only server-verified success for the correct unused reference, exact NGN amount, merchant relationship, and still-eligible booking confirms the reservation idempotently.

At 20 minutes, one Payment-Processing Grace of at most 10 minutes applies only when the PSP positively reports the designated pre-deadline transaction as pending, processing, or otherwise in flight. Checkout opened, customer action still required, ongoing, abandoned, failed, unknown, screenshots, and guest claims do not qualify. Grace protects rail delay rather than indecision and cannot repeat.

Without verified success by 30 total minutes, payment state moves to reconciliation and inventory releases atomically; the old session can no longer confirm dates. Later success is quarantined, communicated accurately, and ordinarily refunded to the original source through its asynchronous lifecycle. It never recreates a booking automatically or defeats inventory priority acquired after release.
