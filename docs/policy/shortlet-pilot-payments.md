# Shortlet pilot payment guidance

The 50–100 apartment pilot uses Paystack's server-created, Paystack-hosted
fresh card checkout for NGN only. The Guest's durable `contactEmail` is the
checkout email. The server supplies the authoritative amount in integer kobo,
currency, reference, callback URL, and `channels: ["card"]`; the browser does
not choose any of them.

The callback is only a return signal. The server verifies the Paystack
transaction and checks the designated Live Payment Attempt, exact reference,
exact amount, NGN currency, provider environment, Payment Window, and existing
booking authority before the existing payment transition can form a
Reservation and Booking Contract. The public Paystack webhook accepts only a
valid HMAC-SHA512 `x-paystack-signature` over the raw body; `charge.success`
also uses the same server verification operation. Card data remains on
Paystack-hosted Checkout.

For this pilot, an invalid or late successful payment is recorded as manual
reconciliation required. Authorized operations staff verify the transaction and
handle any exceptional refund through Paystack's operational tooling, then
record the operational resolution using the existing safe mechanism. The
application does not invoke the Paystack Refund API in this pilot. This is a
narrow active-pilot operating policy for ADR-0045; ADR-0045 remains historical
system policy and automated refund execution is deferred rather than deleted.

Deferred capabilities are automated refunds, refund orchestration, payouts,
settlement automation, saved cards, recurring charging, bank transfer, USSD,
multiple PSPs, and payment operations or analytics dashboards.
