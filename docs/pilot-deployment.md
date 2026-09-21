# Shortlet pilot deployment

The pilot runs one Node application process behind an HTTPS reverse proxy. The
reverse proxy owns TLS; the Node process listens on the private application
port and trusts only the configured public origin for browser-origin checks.

## Runtime and start

- Node.js with the repository's supported `node:sqlite` runtime.
- Install dependencies with `npm ci`.
- Validate/build with `npm run check`.
- Start with `npm run pilot:start`.

Required production environment variables:

- `SHORTLET_PUBLIC_ORIGIN` — the public HTTPS origin only, for example
  `https://pilot.example.com`; it must not contain a path.
- `SHORTLET_DB_PATH` — persistent SQLite file path.
- `SHORTLET_INVENTORY_PATH` — existing persistent inventory JSON file.
- `SHORTLET_OPERATORS_PATH` — existing persistent Operator JSON file.
- `PAYSTACK_SECRET_KEY` — live secret, supplied through deployment secret
  configuration.
- `PAYSTACK_ENVIRONMENT=live`.

`PAYSTACK_CALLBACK_BASE_URL` is not needed by the pilot entry point; the
callback origin is derived from `SHORTLET_PUBLIC_ORIGIN`. If supplied, it must
match that origin exactly.

## Persistent files and public paths

Persist the SQLite file, inventory JSON, and Operator JSON across restarts.
Ephemeral production storage is unsupported. The operations CLIs use the same
`SHORTLET_DB_PATH`, `SHORTLET_INVENTORY_PATH`, and `SHORTLET_OPERATORS_PATH`
values when those variables are present.

Inventory and Operator commands (`pilot:inventory:import`,
`pilot:operator:*`) use the configured JSON files. Operator token provisioning
and revocation (`operator:provision`, `operator:revoke`) use the configured
SQLite database and do not seed fixture inventory when persistent paths are
set. Representative grants remain the authoritative prerequisite for token
provisioning.

The reverse proxy should publish one origin:

- `https://pilot.example.com/` — Guest journey
- `https://pilot.example.com/operator/...` — Operator login and inbox
- `https://pilot.example.com/webhooks/paystack` — Paystack webhook
- `https://pilot.example.com/payments/paystack/callback` — Paystack callback
- `https://pilot.example.com/healthz` — minimal health response

Do not publish fixture applications or their reset/demo endpoints. Production
does not mount Guest `/api/reset`, local-owner reset routes, synthetic request
generation, or fixture impersonation behavior. The local Guest and Owner
applications remain available for development commands only.

## Restart behavior

Restarting the process with the same persistent paths restores valid durable
Guest session bindings, Booking Requests, offers, payment journey state,
Reservations, representative grants, and Operator sessions according to their
existing expiry rules. Losing a Guest browser cookie has no pilot account
recovery path.

Health is `GET /healthz`; it returns only `{ "ok": true }` when the application
has initialized and the SQLite file can be opened.
