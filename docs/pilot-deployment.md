# Shortlet pilot deployment

The pilot is hosted on Cloudflare (ADR 0095). One Worker fronts one SQLite-backed
Durable Object per tenant, which holds the authoritative booking, payment, operator
and interaction state. Receipt evidence and scheduled exports live in the private
`RECEIPTS` and `EXPORTS` R2 buckets, and Static Assets serve the browser bundles and
CSS. The Node application is retired as a production entry; Node runs only the local
development commands and the test suite (see `docs/pilot-local-run.md`).

## Tooling

- Node.js 22.18.0 or later. `.nvmrc` pins the tested version.
- The project-pinned `cf` CLI drives Worker development, builds and deployments.
  Run it from `apps/cloudflare`, or use the `npm run worker:*` scripts from the
  repository root. Vite is the build implementation the Cloudflare plugin hooks
  into; `wrangler` is not a project CLI and is not used directly.
- `cf` is a development dependency, so deploy from a full install (`npm ci`), not
  `npm ci --omit=dev`.

## Build and deploy

Run these on every deploy, on a machine with the development dependencies installed:

1. `npm ci`
2. `npm run check`, `npm run test:workers` and `npm test`
3. `npm run build`. This rebuilds the Guest browser bundles in `apps/local-guest/dist/`
   and copies them into `apps/cloudflare/public/` for Static Assets. The Worker
   serves those files, so a deploy without this step ships stale or missing scripts.
4. Build the mode you are deploying:
   - `npm run worker:build:staging` (`cf build --mode staging`)
   - `npm run worker:build:production` (`cf build --mode production`)
5. Check the deployment plan without publishing:
   - `npm run worker:deploy:dry-run:staging` (`cf deploy --dry-run --mode staging`)
   - `npm run worker:deploy:dry-run:production` (`cf deploy --dry-run --mode production`)
6. Deploy the same mode from `apps/cloudflare`: `cf deploy --mode production`
   (or `--mode staging`), without `--dry-run`.

`--mode` selects a complete, separate deployment. Staging and production have
different Worker, bucket and Durable Object names, and different origins, tenants and
Paystack environments (see `apps/cloudflare/cloudflare.config.ts`). Running with no
mode is the local development configuration.

## Local parity: cf dev

`npm run worker:dev` (`cf dev` from `apps/cloudflare`) runs the Worker locally in the
Workers runtime with a local SQLite-backed Durable Object and simulated R2 buckets.
This is the production-parity local run: the same Worker, Durable Object and asset
code paths that production uses. Run `npm run build` first so the Static Assets exist.
Local secrets belong in a git-ignored `.dev.vars` file, never in the repository.

The local Node commands (`npm run pilot:local`, `npm run guest:local`,
`npm run owner:local`) remain for fast fixture-driven development. They do not
represent production behaviour and are not deployed.

## Configuration

Mode-specific variables are set in `apps/cloudflare/cloudflare.config.ts`. Values that
differ by deployment are fixed there:

- `SHORTLET_PUBLIC_ORIGIN`, `SHORTLET_TENANT_ID` and `SHORTLET_DEPLOYMENT` per mode.
- `PAYSTACK_ENVIRONMENT`: `live` for production (ADR 0087); `test` for staging and
  development. Production refuses test keys and staging refuses live keys.
- `SHORTLET_PAYSTACK_TRANSFERS=disabled` and `CONCIERGE_MODE=deterministic`. Enabling
  either is a configuration change that needs the certification and launch gates in
  ADR 0088, ADR 0090 and the data-protection gates below.

Secrets are declared in `cloudflare.config.ts` by name only. Supply their values
through the `cf` secret workflow, and never commit them:

- `PAYSTACK_SECRET_KEY`
- `GEMINI_API_KEY`
- `RESEND_API_KEY`
- `OPS_SHARED_SECRET` (the `/_ops` shared secret; see Remote operations)

Optional deploy-time variables are passed through the same configuration:

- `SHORTLET_BETA_INVITE_CODE` (staging; required for the closed beta, no spaces).
- `SHORTLET_NOTIFICATION_FROM`, `SHORTLET_OPERATOR_ALERT_EMAILS` and
  `SHORTLET_NOTIFICATION_SWEEP_SECONDS` (email notifications; see below).
- `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` (the Cloudflare Access application that
  protects `/_ops`).
- `SHORTLET_EXPORT_RETENTION_DAYS` and `SHORTLET_RECEIPT_ORPHAN_GRACE_HOURS` (defaults
  are the approved values; Cloudflare deployment issue 12a).

## Staging (closed beta)

The staging deployment runs the same composition for the invite-only beta on Paystack
test keys.

- Staging requires `PAYSTACK_ENVIRONMENT=test` and a `sk_test_` key, and refuses
  live keys. Production refuses test keys.
- Staging serves only an HTTPS public origin, uses secure cookies and mounts no
  fixture routes.
- Every Guest and Operator page shows "Beta: test payments only. No real bookings
  are made."
- With `SHORTLET_BETA_INVITE_CODE` set, a new Guest session starts only from
  `https://<beta-host>/?invite=<code>`; the code is dropped from the address bar once
  the session exists. Anyone without it sees the invite form. Production has no
  invite gate.
- Staging has its own Worker, buckets, Durable Object and tenant. Point the Paystack
  **test** dashboard webhook at `https://<beta-host>/webhooks/paystack`.

## Email notifications (Resend)

Set `RESEND_API_KEY`, `SHORTLET_NOTIFICATION_FROM` and
`SHORTLET_OPERATOR_ALERT_EMAILS` together, or none. With none set, notifications are
disabled and the startup banner says `notifications=disabled`. Without them nobody is
alerted when a Booking Request arrives, so set them for the closed beta and the pilot.

- `SHORTLET_NOTIFICATION_FROM` is a sender on a domain verified in Resend, for example
  `Shortlet <bookings@yourdomain>`.
- `SHORTLET_OPERATOR_ALERT_EMAILS` is the comma-separated list of people covering the
  response window (ADR 0042, launch-readiness issue 09).
- `SHORTLET_NOTIFICATION_SWEEP_SECONDS` is optional, default 30. The sweep runs from
  the Durable Object alarm, which also runs the daily export.

Every sweep reads durable state and sends each email once (recorded in
`pilot_notifications`; Resend receives a stable `Idempotency-Key`):

- Operator alerts: a new delivered Booking Request, and the 10- and 25-minute
  reminders of the 30-minute response window (ADR 0041).
- Guest emails, only when the Guest gave an email address: request sent, offer
  made, payment confirmed, request declined, expired or not delivered.

Emails carry the apartment, dates, party size, amount, deadlines and a link, and never
guest names, phone numbers, identity or payment details (ADR 0075). A failed send is
retried on later sweeps, up to five attempts, and never changes booking state. Events
older than 24 hours when first seen are not announced, so a first deploy does not
email history.

## Guardrails

The Worker applies hourly limits per client address, and per Guest session for chat.
The client address is the `cf-connecting-ip` header that Cloudflare sets; a request
without it shares one `unknown` bucket rather than skipping the limits. A refused
request gets HTTP 429 with `Retry-After` and uses up no allowance. Every value is a
positive whole number; unset uses the default.

| Setting | Default | Limits |
|---|---|---|
| `SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR` | 60 | chat turns per Guest session |
| `SHORTLET_CHAT_TURNS_PER_ADDRESS_PER_HOUR` | 600 | chat turns per client address |
| `SHORTLET_NEW_SESSIONS_PER_ADDRESS_PER_HOUR` | 120 | new Guest sessions (and beta invite attempts) per address |
| `SHORTLET_OPERATOR_LOGINS_PER_ADDRESS_PER_HOUR` | 10 | Operator sign-in attempts per address |
| `CONCIERGE_DAILY_MODEL_CALL_CAP` | 3000 | model calls per day (midnight Africa/Lagos) |
| `SHORTLET_GUEST_RUNTIME_IDLE_MINUTES` | 30 | idle time before a session's in-memory runtime is closed |

Nigerian mobile carriers put many subscribers behind one address, which is why the
per-address limits are high; raise them before a public campaign. Edge rate rules
(Cloudflare deployment issue 13) back these limits up, because the in-memory limiters reset
when the Durable Object is evicted. When the daily model-call cap is spent, new chat
turns use the deterministic concierge until midnight; search and booking pages are
unaffected (ADR 0080).

Request bodies are capped: 64 KiB for chat and event JSON, 256 KiB for Paystack
webhook and callback bodies, and 4 KiB for the Operator sign-in form (HTTP 413).

## Concierge model

The Cloudflare configuration fixes `CONCIERGE_MODE=deterministic`, so the deployed
concierge makes no model calls. Enabling a provider is a configuration change, and
processing guest conversation text with a model provider needs the processor and
transfer clearance in the data-protection gates below. DeepSeek processes guest
conversation text outside Nigeria; do not enable it for real guests until counsel has
cleared the data transfer (launch-readiness issue 03). Before enabling any provider,
run the agent smoke against it (`npm run pilot:local:agent-smoke`) and the assistant
evals (ADR 0079).

## Data protection gates

ADR 0095 records the open launch gates that apply to every deployment that handles
real people's data:

- Cloudflare (Workers, Durable Objects, R2 and Logs) and Google Gemini are assumed
  processors until counsel and vendor contracts confirm their roles, subprocessors
  and terms.
- Do not process production or real-person data until counsel approves the
  cross-border transfer basis, safeguards, destinations and DPIA or vendor terms.
  Staging may use synthetic data while that gate is open.
- Retention periods, Cloudflare Logs retention and R2 export retention remain
  provisional until approved (ADR 0075, issue 12a).

## Persistent state and public routes

The Durable Object's SQLite storage is the system of record for each tenant. Receipts
and exports are in private R2 buckets; receipt access stays inside the authorized
back-office flow (ADR 0090). Inventory and Operator records are imported and managed
through the remote operations below, not by editing files.

The Worker serves one origin, `SHORTLET_PUBLIC_ORIGIN`:

- `/` for the Guest journey
- `/operator/...` for Operator login and inbox
- `/webhooks/paystack` for the Paystack webhook
- `/payments/paystack/callback` for the Paystack callback
- `/healthz` for a minimal health response
- `/_ops/...` for the authenticated remote operations routes

Fixture applications, reset and demo endpoints, synthetic request generation and
fixture impersonation are not mounted in any deployed mode.

## Restart and health

Durable state lives in the Durable Object and R2, so a Worker or Durable Object restart
restores Guest session bindings, Booking Requests, offers, payment journey state,
Reservations, representative grants and Operator sessions according to their existing
expiry rules. A closed session runtime is rebuilt from storage on the Guest's next
request; only the in-memory assistant conversation is lost. Losing a Guest browser
cookie has no pilot account recovery path.

`GET /healthz` returns only `{ "ok": true }` once the application has initialized and
the Durable Object storage is available.

## Remote operations

The operator tools reach the deployed tenant over HTTPS. `pilot:operator:*`,
`pilot:inventory:import`, `operator:provision` and `operator:revoke` call the `/_ops`
routes when `SHORTLET_OPS_URL` is set:

- `SHORTLET_OPS_URL` is the deployment's origin (https, or http only for `localhost`).
- `SHORTLET_OPS_SECRET` is the `X-Shortlet-Ops-Secret` value (the `OPS_SHARED_SECRET`
  secret).
- `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` are the Cloudflare Access
  service-token credentials.

Both `/_ops` layers fail closed: a missing shared secret or Access identity rejects the
request. With `SHORTLET_OPS_URL` unset the tools use local files and SQLite, which is
only for local development. A provisioned operator token is printed once to stdout and
is never written to a file or a log. `operator:revoke` revokes all of an actor's access
through the ops route; revoking a single session stays a back-office action.

The `pilot:local:*` commands remain local-only. They run the fixture pilot against a
local SQLite file and are not part of the Cloudflare deployment.
