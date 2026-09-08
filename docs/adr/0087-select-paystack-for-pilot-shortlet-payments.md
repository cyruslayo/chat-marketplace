# Select Paystack for pilot Shortlet payments

## Context

The 50–100 apartment Nigerian Shortlet pilot needs one production-capable payment provider for the existing server-authoritative journey. The platform must initialize payment on the server, redirect the Guest to a provider-hosted card checkout, accept authenticated provider notifications, verify the transaction server-side, and then continue the existing Payment Window, Reservation, and Booking Contract journey. The pilot is card-only and NGN-only; bank transfer, USSD, and other methods remain capability-gated by their existing ADRs.

This decision was researched against official provider documentation accessed 2026-09-08. ADR-0002's Paystack reference is historical Commerce input and is not treated as current Shortlet authority. Provider selection is separate from production-equivalent capability certification.

## Decision

Select **Paystack Redirect API / hosted Checkout** for the initial Shortlet pilot, using **NGN Fresh Card Checkout** only.

The adapter remains behind the existing provider-neutral payment port. No Paystack SDK or browser payment SDK is required by this decision; the preferred implementation is direct server HTTPS calls using the platform's existing HTTP/runtime facilities.

### Initialization and hosted handoff

The server creates one unique platform/payment-attempt reference and calls Paystack's server-side `POST /transaction/initialize` with the authoritative amount in kobo, NGN currency, Guest email from the authenticated Guest context, a server-controlled callback URL, and `channels: ["card"]`. The server returns only the validated Paystack `authorization_url` to the existing Guest payment surface. Card credentials and issuer challenges remain on Paystack-hosted Checkout.

The platform revalidates the accepted Conditional Booking Offer, Payment Window, exact Amount Due Now, currency, and Live Payment Attempt before initialization. The browser never supplies authoritative amount, currency, reference, or redirect destination.

### Callback and webhook

The callback restores the authenticated Guest thread and payment attempt but is not proof of payment. The server verifies the reference through Paystack's transaction verification endpoint before any booking state transition.

Paystack `charge.success` is the success notification used for asynchronous completion. Webhook requests must validate `x-paystack-signature` as HMAC-SHA512 over the raw request body using the environment-bound secret key, reject malformed or mismatched events, check event identity/reference/merchant environment, and return promptly. Duplicate event IDs/references are idempotently ignored after the first authoritative processing. Paystack documents live retries every three minutes for four attempts then hourly for 72 hours when a webhook is not acknowledged; test-mode retries are hourly for 10 hours.

### Verification and state mapping

Server verification must match the expected unique reference, `status === success`, exact NGN amount, exact currency, and the expected live/test environment. Unknown provider states fail closed. The initial mapping is:

| Paystack state | Platform state |
|---|---|
| initialized / authorization URL issued | initialized |
| `pending`, `ongoing`, `processing`, `queued` | pending or processing according to the existing payment journey |
| `success` plus exact server verification | verified |
| `failed`, `abandoned`, `reversed` | failed |
| platform Payment Window reached | expired |
| provider success after platform authority/inventory expiry | late / reconciliation |

The platform owns the 20-minute Payment Window and 10-minute processing grace. A provider's later success cannot revive inventory or create a Reservation after the platform deadline. Late success follows ADR-0045's original-source refund/reconciliation path.

### Refunds

Paystack supports full or partial refunds, refund status retrieval, and refund webhooks (`refund.pending`, `refund.processing`, `refund.needs-attention`, `refund.failed`, and `refund.processed`). The later adapter must use a stable platform refund idempotency/reference and correlate the refund to the original Paystack transaction. Refunds may remain pending or need customer bank details; the platform must not describe initiation as receipt. General refund UX is out of scope.

### Idempotency, secrets, and environments

The platform remains the idempotency authority. One Live Payment Attempt, one designated Paystack reference, one verified payment transition, one Reservation, and one Booking Contract are permitted. Repeated browser returns, webhook deliveries, restarts, and concurrent verification must resolve to the existing durable outcome.

Only provider name, environment, merchant/integration identifier where required, safe provider reference, expected amount/currency, and normalized status may enter application persistence. Secret keys and webhook secrets remain in environment/secret configuration and never enter browser state, telemetry, audit, or application data. Test and live API hosts/credentials are separate; production verification must reject test-domain transactions.

### Certification

This ADR selects Paystack but does **not** certify card capability. The later adapter must pass the repository's provider contract and capability-certification gates, including hosted checkout, exact amount/currency verification, signature validation, duplicate/replay handling, Payment Window expiry, processing grace, late success, refund lifecycle, and sandbox/live separation. An opt-in Paystack sandbox journey is required when credentials are available; normal CI must remain credential-free.

## Alternatives considered

### Flutterwave Standard

Flutterwave provides server-created hosted payment links, NGN defaults, unique `tx_ref`, webhooks with HMAC-SHA256 `flutterwave-signature`, and server verification. It was not selected because its public verification guidance permits fulfillment when the returned amount is greater than or equal to the expected amount, which conflicts with this pilot's exact-amount rule unless an adapter adds stricter controls. Its webhook/event and refund contract is also a larger integration surface for the narrow pilot.

### Monnify Checkout API

Monnify provides server-created hosted Checkout, NGN, unique `paymentReference`, server verification, and refund status/webhooks. It was not selected because its official documentation states `monnify-signature` is absent from sandbox webhook notifications, creating a meaningful certification gap for replay/signature parity, and refund API activation is not enabled by default; refund eligibility also varies by payment rail and wallet funding. Those operational dependencies are disproportionate for this pilot.

## Consequences

Paystack becomes the single pilot provider boundary for card checkout. The repository still owns payment authority, deadlines, state transitions, reservation formation, contract formation, audit, telemetry, and late-payment remediation. Additional payment methods and alternate PSPs require separate capability certification or ADR changes. Commercial onboarding, fees, settlement timing, and account approval remain subject to provider confirmation and are not invented here.
