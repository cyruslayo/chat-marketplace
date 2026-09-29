# Shortlet pilot deployment

The pilot runs one Node application process behind an HTTPS reverse proxy. The
reverse proxy owns TLS; the Node process listens on the private application
port and trusts only the configured public origin for browser-origin checks.

## Runtime and start

- Node.js 22.13.0 or later (`node:sqlite` without a flag); `.nvmrc` pins the
  tested version.
- Install runtime dependencies with `npm ci --omit=dev` (with
  `NODE_ENV=production`, plain `npm ci` does the same).
- Build the Guest browser bundle with `npm run build`, on every deploy.
- Start with `npm run pilot:start`.
- Run `npm run check` and `npm test` before deploying, on a machine with the
  development dependencies installed; the server does not need them.

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

## Staging (closed beta)

`SHORTLET_DEPLOYMENT=staging` runs the same production composition for the
invite-only beta on Paystack test keys. Unset means `production`; any other
value fails startup.

- Staging requires `PAYSTACK_ENVIRONMENT=test` and a `sk_test_` key, and
  refuses live keys. Production refuses test keys, as before.
- Staging still requires an HTTPS `SHORTLET_PUBLIC_ORIGIN`, persistent paths
  and secure cookies, and mounts no fixture routes.
- Every Guest and Operator page shows "Beta: test payments only. No real
  bookings are made."
- `SHORTLET_BETA_INVITE_CODE` is required (no spaces). A new Guest session
  starts only from `https://<beta-host>/?invite=<code>`; the code is dropped
  from the address bar once the session exists. Anyone without it sees the
  invite form. Production refuses this setting.
- Run staging on its own host, data directory and environment file, never
  sharing the production database. Point the Paystack **test** dashboard
  webhook at `https://<beta-host>/webhooks/paystack`.

## Email notifications (Resend)

Set all three, or none (none disables notifications and the startup banner says
`notifications=disabled`). Run the closed beta and the pilot with them set:
without them nobody is alerted when a Booking Request arrives.

- `RESEND_API_KEY` — from the Resend dashboard, supplied as a secret.
- `SHORTLET_NOTIFICATION_FROM` — a sender on a domain verified in Resend, for
  example `Shortlet <bookings@yourdomain>`.
- `SHORTLET_OPERATOR_ALERT_EMAILS` — comma-separated addresses of the people
  covering the response window (ADR 0042, launch-readiness issue 09).
- `SHORTLET_NOTIFICATION_SWEEP_SECONDS` — optional, default 30.

Every sweep reads the database and sends each email once (recorded in
`pilot_notifications`; Resend receives a stable `Idempotency-Key`):

- Operator alerts: a new delivered Booking Request, and the 10- and 25-minute
  reminders of the 30-minute response window (ADR 0041).
- Guest emails, only when the Guest gave an email address: request sent, offer
  made, payment confirmed, request declined, expired or not delivered.

Emails carry the apartment, dates, party size, amount, deadlines and a link, and
never guest names, phone numbers, identity or payment details (ADR 0075). A
failed send is retried on later sweeps, up to five attempts, and never changes
booking state. Events older than 24 hours when first seen are not announced, so a
first deploy does not email history.

## Guardrails

The pilot's front server applies hourly limits per client address, and per
Guest session for chat. The client address is the rightmost `X-Forwarded-For`
entry the reverse proxy adds; the pilot only listens on loopback. A refused
request gets HTTP 429 with `Retry-After` and uses up no allowance. Every value
is a positive whole number; unset uses the default.

| Setting | Default | Limits |
|---|---|---|
| `SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR` | 60 | chat turns per Guest session |
| `SHORTLET_CHAT_TURNS_PER_ADDRESS_PER_HOUR` | 600 | chat turns per client address |
| `SHORTLET_NEW_SESSIONS_PER_ADDRESS_PER_HOUR` | 120 | new Guest sessions (and beta invite attempts) per address |
| `SHORTLET_OPERATOR_LOGINS_PER_ADDRESS_PER_HOUR` | 10 | Operator sign-in attempts per address |
| `CONCIERGE_DAILY_MODEL_CALL_CAP` | 3000 | model calls per day (midnight Africa/Lagos) |
| `SHORTLET_GUEST_RUNTIME_IDLE_MINUTES` | 30 | idle time before a session's in-memory runtime is closed |

Nigerian mobile carriers put many subscribers behind one address, which is why
the per-address limits are high; raise them before a public campaign. When the
daily model-call cap is spent, new chat turns use the deterministic concierge
until midnight; search and booking pages are unaffected (ADR 0080). A closed
session runtime is rebuilt from SQLite on the Guest's next request; only the
in-memory assistant conversation is lost.

Request bodies are capped: 64 KiB for chat and event JSON, 256 KiB for Paystack
webhook and callback bodies, and 4 KiB for the Operator sign-in form (HTTP 413).

## Concierge model

The concierge settings are validated at startup, and the startup banner prints
`concierge=`, `model=` and `fallback=` (never keys or base URLs, ADR 0075).
Check the banner after every deploy.

- `CONCIERGE_MODE` — `deterministic` (the default when unset; no model),
  `gemini`, or `openai-compatible`. Any other value fails startup, so a typo
  can never silently switch the AI concierge off.
- `gemini` requires `GEMINI_API_KEY`. `GEMINI_MODEL` and
  `GEMINI_THINKING_LEVEL` (`minimal`, `low`, `medium` or `high`) are optional.
- `openai-compatible` requires `LLM_API_KEY`, an HTTPS `LLM_BASE_URL` and
  `LLM_MODEL`. `LLM_PROVIDER_LABEL` (lowercase, for example `deepseek`) names
  the provider in the banner. DeepSeek: `LLM_BASE_URL=https://api.deepseek.com`,
  `LLM_MODEL=deepseek-chat`. OpenAI: `LLM_BASE_URL=https://api.openai.com/v1`.
- `CONCIERGE_FALLBACK=openai-compatible` (only with `CONCIERGE_MODE=gemini`)
  sends a turn to the `LLM_*` provider when Gemini is unavailable: a connection
  failure or timeout, a rate limit, or a server error. Other failures fail
  closed as before. Conventional search and booking routes never depend on the
  model (ADR 0080).

Before enabling a provider or changing a model, run the agent smoke against it
(`npm run pilot:local:agent-smoke`) and the assistant evals (ADR 0079). DeepSeek
processes guest conversation text outside Nigeria; do not enable it for real
guests until counsel has cleared the data transfer (launch-readiness issue 03).

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
