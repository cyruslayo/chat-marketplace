# `/_ops` authentication and operator routes

Status: ready-for-agent
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
