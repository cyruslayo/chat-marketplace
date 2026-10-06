# Worker, Durable Object and typed `cf` configuration, running on `cf dev`

Status: ready-for-agent
Type: task
Blocked by: 01b, 03b, 04c, 07b, 08c, 09b, 09c, 10a
Branch: `infra/cf-10b-worker-do`
Requested: 2 Oct 2026
Unlocks: 11a, 12a, 12b, 13

## Why

This is the assembly slice. Every part now exists behind a port, so it can be wired into one Worker and one SQLite-backed Durable Object that runs the full pilot locally on workerd.

## What to build

**`apps/cloudflare/cloudflare.config.ts`:**
- Define the Worker entrypoint, `nodejs_compat`, and current compatibility date with the pinned `cf/config` API validated in 01c.
- Declare SQLite-backed Durable Object export/binding `SHORTLET`, including class initialization/migration details confirmed in 01c.
- Declare R2 buckets `RECEIPTS` and `EXPORTS`, and configure static assets using the selected `cf` builder.
- Define every non-secret binding the 10a loader reads. Secrets (Paystack keys, `GEMINI_API_KEY`, notification keys) are **only** documented, never committed. Put local values in `.dev.vars` and add it to `.gitignore`.
- Return complete, explicit staging and production configurations selected by `--mode`, with separate bucket names and Durable Object namespaces.

**`src/worker.ts`:**
- Static Assets handle asset paths automatically.
- Everything else is forwarded to `env.SHORTLET.get(env.SHORTLET.idFromName(tenantId), { locationHint: "afr" })`.
- Cross-check `locationHint` against 01b and the current API.

**`src/shortlet-pilot-do.ts` (`ShortletPilot`):** inside `ctx.blockConcurrencyWhile`:
1. `new DurableObjectSqlDatabase(ctx.storage)`, then schema creation.
2. `SqliteUnitRepository` and `SqliteOperatorRepository`.
3. Both environments with injected deps (04a, 04b), `production: true`, and live Paystack clients built exactly as `startPilotServer` builds them.
4. `R2ReceiptBlobStore`, `SqliteAuditLog` and `SqliteTelemetry` with a JSON `console.log` sink of redacted events only.
5. The session-runtime cap from configuration (04c).
6. `createPilotRequestHandler` with `clientAddressFromCloudflare`, and the asset loader for the inlined CSS (09a).

Then:
- `fetch(request)` runs `toHttpRequestLike`, the handler, and returns the Response.
- **`alarm()`** replaces the Node notifier's `setInterval` (`pilot-server.ts:185`). It runs `notifier.sweep()` and reschedules itself every `notifications.sweepSeconds`. Structure it as a small task list, because 12a adds the daily export to the same alarm. An alarm that throws reschedules itself and does not stop.

**Bundle guard:** use the `cf build` output or an esbuild metafile check, run in `npm run test:workers` or as `npm run check:worker-bundle`, that fails if `node:sqlite` or `node-sqlite-database.ts` is in the Worker graph.

## Out of scope

- `/_ops` routes (11), export (12a), WAF and domain (13), and real deploys (15).

## Acceptance criteria

- AC1: `cf dev`, with `.dev.vars` holding test keys, serves the guest home page, and a full discovery → request → offer journey works in the preview browser against local Durable Object and R2 simulation.
- AC2: An operator can log in at `/operator` with a token provisioned through a workers-test helper (the real ops route is 11a), and the session survives a Durable Object restart (`cf dev` restart).
- AC3: The bundle guard fails when `node:sqlite` is imported anywhere in the Worker graph, and passes on the real build.
- AC4: A vitest-pool-workers integration spec drives `SELF.fetch` through the Worker into the Durable Object for `/healthz`, a guest page and the Paystack webhook signature failure path (401, nothing changes).
- AC5: The alarm runs the notifier sweep and reschedules itself, including after a thrown sweep. `npm run test:workers`, `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0004 | One Durable Object is the system of record | `idFromName(tenantId)` |
| 0087 / 0088 | Live Paystack bound to the origin; transfers gated | 10a config reused |
| 0075 | Workers Logs carry no secrets | telemetry sink gets redacted events only |
| 0079 | Durable dedupe | SQLite telemetry and notifier tables |

## Watch-outs

- Never `await` inside `db.transaction` (PRD).
- `Date.now()` does not advance during synchronous work.
- Watch the size of `guest_threads.thread_json` against the 2 MB value limit.

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`. Attach a screenshot of the guest journey on `cf dev`.

## Comments
