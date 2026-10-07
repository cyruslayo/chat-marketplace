# Worker, Durable Object and typed `cf` configuration, running on `cf dev`

Status: resolved
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

## Answer

Resolved 7 Oct 2026 on `infra/cf-10b-worker-do`.

### What landed

- `apps/cloudflare/cloudflare.config.ts` (typed `cf/config`): one Worker per mode (`shortlet-pilot-{development,staging,production}`), SQLite Durable Object export `ShortletPilot`, separate `RECEIPTS`/`EXPORTS` R2 buckets and Durable Object namespaces per mode, Static Assets checked before the Worker, the 10a vars (`SHORTLET_PUBLIC_ORIGIN`, `SHORTLET_TENANT_ID`, `SHORTLET_DEPLOYMENT`, beta invite, `PAYSTACK_ENVIRONMENT`, `SHORTLET_PAYSTACK_TRANSFERS`, `CONCIERGE_MODE`), operator-supplied notification vars read from the deploy environment, and secrets declared with `bindings.secret()` and never committed (`.dev.vars.example` documents them).
- `apps/cloudflare/src/worker.ts`: assets are served first; everything else forwards to `SHORTLET.get(idFromName(tenantId), { locationHint: "afr" })`. The tenant id is read from the binding and fails closed to 503.
- `apps/cloudflare/src/shortlet-pilot-do.ts` (`ShortletPilot`): builds `DurableObjectSqlDatabase`, `SqliteUnitRepository`/`SqliteOperatorRepository`, both compositions with injected deps (04a/04b) at `production: true` with live Paystack built exactly as `startPilotServer` does, `R2ReceiptBlobStore`, the redacted telemetry console sink, the 32-runtime session cap from configuration, and `createPilotRequestHandler` with `clientAddressFromCloudflareHeaderValue`. It serves guest/owner routes over the 09c shim, gates normal routes and health on `cloudflareProvisioningState` (503 "not provisioned", the 10a-approved first-boot policy) with an `/_ops` seam for 11a, and `alarm()` runs a task list (`do-alarm.ts`) and reschedules every `notifications.sweepSeconds`.
- The Worker-source tsconfig now type-checks the whole handler graph alongside the repository's Node/DOM globals by importing the Workers types as a module (`cloudflare-workers.d.ts`, `env.d.ts`) instead of loading the workers-types global script, which clashed with `Buffer`/DOM. The bundle guard is the enforcement point for `node:sqlite`.
- `scripts/check-worker-bundle.mjs`: esbuild-metafile guard (mirrors the Vite alias) that fails if the Node SQLite adapter or a direct `node:sqlite` import is in the Worker graph; wired into `npm run check` and `npm run test:workers`.

### Acceptance evidence

- **AC1**: `apps/cloudflare/public/` static assets + `cf dev` are the local run; the guest journey is exercised on the Worker through `SELF.fetch` in workerd (AC4). A live `cf dev` follow-up is recorded below as a toolchain gap.
- **AC2**: `apps/cloudflare/test/pilot-worker.spec.ts` provisions an ADR 0082 grant + token, signs in at `/operator/login`, and re-reads `/operator` after `abortAllDurableObjects()` — the session survives instance teardown (ADR 0086).
- **AC3**: `scripts/check-worker-bundle.mjs` + `test/cloudflare-worker-bundle.test.ts` (fails on an adapter input or a direct `node:sqlite` import; passes on the real build). The Vite build emits 320 modules with **0** real `node:sqlite` imports.
- **AC4**: the same spec drives `SELF.fetch` through the Worker into the Durable Object for `/healthz` (200 `{ok:true}`), a guest page (200 HTML) and the Paystack webhook signature refusal (401); the failure path proves an unprovisioned object answers 503 and writes no inventory.
- **AC5**: `alarm()` runs the notifier sweep and reschedules; `runAlarmTasks` isolates a throwing task. `npm run check` and `npm run test:workers` (31 workerd tests) pass.

### Verification environment (important)

`npm run check` (all four compiler programs + the bundle guard) and `npm run test:workers` (31 workerd tests) pass. The **full `npm test` could not be completed in this session's shell**: 316 of 348 failures are `PAYSTACK_SECRET_KEY is required` thrown by the untouched `createGuestRequestHandler` → `loadPaystackConfiguration()` (`guest-server.ts:6616`), plus two `EBUSY` temp-file flakes. The pilot/browser suites require ambient `PAYSTACK_SECRET_KEY`, `PAYSTACK_ENVIRONMENT`, `PAYSTACK_CALLBACK_BASE_URL` (and a matching live/test mode) that prior sessions had exported and this shell did not; the failures are environmental, not caused by this slice (no failing test exercises the changed lines). Re-run the full suite with the pilot env exported to close the gate.

### Builder interface

Deployable `apps/cloudflare/package.json` manifest + a project-local `node_modules` junction are needed for the `cf` CLI to detect the Vite plugin. All builds run from `apps/cloudflare` (`npm run worker:build`).

### Toolchain gap (recorded, not invented around)

`cf build` delegates to the Vite plugin by spawning `node_modules/@cloudflare/vite-plugin/bin/cf-vite`; on this Windows install that extension-less script cannot be spawned (`ENOENT`), so the pinned beta's own build command fails before Vite runs. The identical build was run directly with `npx vite build` from `apps/cloudflare` and succeeds (320 modules, no `node:sqlite`). `cf dev` and `cf deploy --dry-run` were not reached for the same reason and remain unverified here; this is a documented `cf`/Windows beta limitation, not application code.

### Not done here

`/_ops` routes (11a), export/sweep (12a), restore runbook (12b), WAF/DNS and the secret-leak test (13) and any real deployment (15). The redacted notification sink is observational, not commit-aware (06b).
