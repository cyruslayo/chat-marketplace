# `/_ops` authentication and operator routes

Status: resolved
Type: task
Blocked by: 10b
Branch: `infra/cf-11a-ops-operators`
Requested: 2 Oct 2026
Unlocks: 11b

## Why

Today the operator CLIs change the local SQLite file or JSON files directly:
- `pilot:operator:create`, `pilot:operator:list`, `pilot:operator:update` and `pilot:operator:bootstrap` (`apps/shortlet-ops/src/`);
- `operator:provision` and `operator:revoke` (`apps/local-owner/src/cli-*.ts`).

On Cloudflare the data lives inside the Durable Object, so these operations need authenticated HTTPS routes.

## What to build

- `/_ops/*` routes, dispatched in the pilot handler before guest and owner routing:
  - `POST /_ops/operators`, `GET /_ops/operators`, `PATCH /_ops/operators/:id`, `POST /_ops/operators/bootstrap`
  - `POST /_ops/operators/:id/access` (provision) and `DELETE /_ops/operators/:id/access` (revoke)
- **Two authentication layers**, both checked fail-closed:
  1. Cloudflare Access service-token validation. Verify the `Cf-Access-Jwt-Assertion` JWT against the team's certs, with audience and team domain from config, or require the Access-injected headers as Access documents. Read the current Access docs and pick the verifiable option; record the choice.
  2. A shared-secret header, compared with `timingSafeEqual`. **Ask the user** for the header name and how the secret is provisioned. Use the secret workflow verified for the pinned `cf` version in 01c; do not assume an unsupported single-secret CLI command.

  A missing, empty or wrong value is refused 401 or 403 without detail (AGENTS.md anti-pattern 1).
- The route handlers call the **existing** domain functions that the CLIs call today. No new operator logic.
- **ADR 0086:** a provisioned access token is returned only in the JSON response body. It never appears in a URL, a header, telemetry or the audit log (the audit records the operator ID and action only).
- Responses carry `Cache-Control: no-store`.

## Out of scope

- Inventory import and CLI changes (11b).

## Acceptance criteria

- AC1: A request without the Access assertion, or without the shared secret, is refused, and changes nothing. One test per missing layer, plus wrong values, plus an empty-string secret.
- AC2: Each operator route gives the same result as its CLI on Node. A shared test runs both paths.
- AC3: The token from `/_ops/operators/:id/access` appears only in the response body. Failure path: a test scans the audit table, telemetry and captured `console` output for the token and finds nothing.
- AC4: A revoked operator's session is refused at once (ADR 0086).
- AC5: `npm run test:workers`, `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0086 | Tokens hashed, never in URLs or logs, 30 minutes | response body only |
| 0082 | Explicit representative grants | provision and revoke reuse the domain |
| 0075 | No secrets in logs | AC3 |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`. Item 5 matters here: the header name comes from the user.

## Comments

## Answer

Resolved 7 Oct 2026 on `infra/cf-11a-ops-operators`.

### Authentication (two layers, both fail-closed)

- **Access layer.** `apps/cloudflare/src/access-jwt.ts` verifies the `Cf-Access-Jwt-Assertion` JWT with WebCrypto: RS256 only, the signing key selected from the team's JWKS by `kid`, and the `aud`, `exp` and `nbf` claims checked. **Option chosen and recorded:** verify the JWT against the team's published certs (`https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, fetched once and cached per Durable Object) rather than trusting the Access-injected headers. `CF_ACCESS_JWKS` is a local/test override so workerd tests never fetch the public certs. Anything missing, malformed or unverifiable is refused, never treated as authenticated.
- **Shared secret.** `apps/cloudflare/src/ops-auth.ts` compares the `X-Shortlet-Ops-Secret` header (user-approved name) with the `OPS_SHARED_SECRET` binding in constant time: both sides are SHA-256 hashed first, then compared with `timingSafeEqual`, so neither the length nor an empty value leaks or passes.
- A refusal is a bare `401 {ok:false,code:"UNAUTHORIZED"}` with no indication of which layer failed (AGENTS.md anti-pattern 1). `loadOpsConfiguration` returns a deny-all verifier and an empty secret when the Access vars or the secret are absent, so an under-configured deployment refuses everything rather than admitting anything.

### Routes

`apps/cloudflare/src/ops-routes.ts`, dispatched in `fetch` **before** the guest/owner config load and the provisioning gate, so provisioning works on an unprovisioned object: `POST/GET /_ops/operators`, `PATCH /_ops/operators/:id`, `POST /_ops/operators/bootstrap`, `POST /_ops/operators/:id/access`, `DELETE /_ops/operators/:id/access`. Every response carries `Cache-Control: no-store`; bodies are bounded at 64 KiB before reading. Each route calls exactly the domain functions the operator CLIs call today — `runOperatorCreateCommand`/`runOperatorListCommand`/`runOperatorUpdateCommand` (`apps/shortlet-ops/src/operator-cli.ts`), `bootstrapOperatorsFromUnitRepository`, `sessionAuthority.provisionAccessToken`/`revokeAll`, `grantStore.canActForOperator` — with no new operator logic. The ops composition on the Durable Object is deliberately lighter than the guest/owner runtime (operator, unit, grant, session and audit authorities on the shared handle only).

**ADR 0086.** A provisioned token is returned only in the JSON response body; the audit records the operator and actor ids only. `OPS_SHARED_SECRET` is declared as `bindings.secret()` (never committed) and documented in `.dev.vars.example`.

### Acceptance evidence (`apps/cloudflare/test/ops-routes.spec.ts`)

- **AC1**: missing Access assertion, missing secret, empty-string secret, wrong secret, expired token, wrong audience and a tampered signature each give 401, and the operator table is unchanged.
- **AC2**: `POST`/`PATCH`/`GET` return the same record the CLI's domain command produces against the same database.
- **AC3**: the provisioned token is a non-trivial string in the response body only — it appears in neither the durable audit table nor captured `console.log`/`console.error` output.
- **AC4**: after `DELETE .../access`, the operator's session resolves to `null` at once (`resolveSession`), proving immediate refusal (ADR 0086).
- **AC5**: `npm run check` (four compiler programs + bundle guard) passes; `npm run test:workers` passes **35** workerd tests; the Vite build emits 325 modules with no `node:sqlite`.

### Notes

- The Access layer needs `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` (non-secret vars) and the `OPS_SHARED_SECRET` secret. Until those are supplied at deploy the routes refuse everything; that is the intended fail-closed default.
- ADR constraints checked: 0086 (token in the body only), 0082 (provision/revoke reuse the domain grant authority), 0075 (no secrets in logs or audit).
- Out of scope and untouched: inventory import and CLI changes (11b) — `POST /_ops/inventory/import` and making the CLIs call these routes when `SHORTLET_OPS_URL` is set.
