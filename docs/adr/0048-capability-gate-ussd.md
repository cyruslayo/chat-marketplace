# Capability-gate USSD

USSD is not a guaranteed launch payment method. It remains disabled until the selected PSP passes Payment Capability Certification showing one booking-specific amount-bound reference, provider-enforced non-payability at the 20-minute deadline, reliable customer-action, processing, terminal and unknown states, irreversible invalidation, authenticated server verification, and deterministic treatment of attempts after expiry. Generic PSP support or dashboard enablement is insufficient.

A USSD session that remains payable owns the single Live Payment Attempt and prevents switching. Only a PSP-confirmed in-flight transaction before the deadline may receive Payment-Processing Grace; displayed codes, dialer opening, customer claims, debit alerts, awaiting action, and unknown states do not qualify. Success after inventory release is fully refunded and never confirms a booking.

Certification uses production-equivalent pre/post-expiry, initiated-before/settled-after, reuse, cancellation/switching, duplicate event, outage, amount, concurrency, and late-success tests. Payment channels are explicitly configured per transaction; until USSD passes, launch exposes only separately certified cards and Expiring Bank Transfer.
