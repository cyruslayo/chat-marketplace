# Require expiring booking-specific bank transfers

Bank transfer is disabled for launch checkout unless the PSP supplies an Expiring Bank Transfer with a unique booking reference or temporary account, exact NGN amount binding, authenticated status events, and provider-enforced non-payability at the 20-minute Payment Window deadline. Persistent customer accounts, reusable details, and references that outlive inventory are prohibited even if useful for other products.

The transfer reference expires at 20 minutes even when the PSP recognized an in-flight transfer before that moment and the booking receives Payment-Processing Grace. Grace permits only that already designated transaction to finish; it never extends payability or permits new initiation. While reference payability remains possible, it owns the single Live Payment Attempt and cannot be replaced merely through a guest cancellation action.

Before activation, production-equivalent certification tests pre/post-expiry payment, initiated-before/settled-after behavior, reuse, incorrect and duplicate amounts, delayed and duplicate events, outages, provider clocks, and the treatment of money sent after expiry. Inventory release always wins over late success, which follows ADR-0045's mandatory full refund and never confirms a booking.
