# Local Guest Weaver Demo

This is a deterministic local demonstration of the guest Shortlet booking journey. It is not a production concierge or payment integration.

## Run it

From the repository root:

```sh
npm install
npm run guest:reset
npm run guest:local
```

Open <http://localhost:3001>. The local apartment-owner demo continues to use <http://localhost:3000>.

Use this canonical prompt to exercise the complete journey:

> I need an apartment in Ikoyi for 3 nights for 2 people

The local concierge is a small deterministic regex interpreter. It is deliberately not an LLM; it supplies fixed demo dates (15–18 August 2026) and asks for clarification when location, nights, or guest count cannot be safely interpreted.

## Journey stages

1. Discovery renders the two eligible Lagos Units with Weaver Basic Catalog A2UI, All-In Stay Total, separate Refundable Security Deposit, inspection, and management-trust facts.
2. View Unit requests a server-generated Unit detail surface.
3. Request to Book creates and discloses a real Booking Request through the guest verification and availability application paths.
4. The local fixture simulates the authorized Operator representative confirming the request and issuing a Conditional Booking Offer.
5. Accept Offer creates the payment projection. Start secure checkout uses a deterministic local PSP stub; no card data or live provider is used.
6. Verified payment commits the reservation and exposes the resulting Booking Contract projection. Arrival data remains locked in this demo.

Every consequential action is emitted by Weaver and sent to the server. The browser owns only presentation and interaction projection state; the server validates the allow-listed action, current surface, identity, authorization, amount, and aggregate state.

## Reset and troubleshooting

`npm run guest:reset` removes the local guest SQLite fixture. The HTTP reset endpoint (`POST /api/reset`) also rebuilds the complete environment and clears interaction threads. A reset makes old surface events invalid and restores the deterministic first discovery artifact (`search-guest-demo-001`).

If the page says the client bundle is missing, run `node apps/local-guest/scripts/build-client.mjs` or restart with `npm run guest:local`. If a stale process owns port 3001, stop it before restarting. The demo uses only local fixtures and has no production credentials.
