# Plan: Port the Shortlet pilot to Cloudflare (Workers + one Durable Object + R2)

## Context

Today the production pilot is one Node process (`apps/pilot/src/pilot-server.ts`). It proxies to two in-process HTTP servers (the Guest server, and the Operator back office under `/operator`). Both share one SQLite file opened with `node:sqlite` (`SHORTLET_DB_PATH`). The audit found that Cloudflare can host the whole application. The fit is one Worker in front of **one SQLite-backed Durable Object** running the existing guest and operator composition, plus **R2** for receipts and **Static Assets** for the browser bundles.

A Durable Object is the right target and D1 is not, for these reasons:
- The domain layer calls SQLite synchronously: ~125 prepared statements and ~600 named `$params` across 16 files.
- It relies on `BEGIN IMMEDIATE` read-then-write transactions for inventory holds, the payment window, and the single live payment attempt (ADRs 0041, 0044, 0046).
- Durable Object SQL is synchronous, single-threaded, and has `transactionSync`. D1 is async, which would force an async rewrite of ~16k lines of domain code.

Goal: build this on a separate integration branch, prove it on a Cloudflare staging deployment, then merge to `main` and make Cloudflare the only production platform. The Node path stays for local development and the existing test suite.

Decisions already made with the user:
- Receipts go to a **private R2 bucket**.
- The HTTP layer is ported **with an adapter shim first**, not rewritten as fetch-native.
- The first execution step publishes this plan as `.scratch/cloudflare-deployment/PRD.md` plus numbered issues.
- Workers development, build and deployment use Cloudflare's `cf` CLI, pinned in the project, with typed `cloudflare.config.ts`. This CLI and configuration are in beta; issue 01c validates the toolchain before dependent implementation.

---

## Branching and delivery

- Integration branch: **`infra/cloudflare-deployment`**, cut from `main`. Do not cut it from `ui/listing-gallery`, which has uncommitted UI work.
- Each issue below gets its own short branch. Its PR targets `infra/cloudflare-deployment`, not `main`.
- Merge `main` into the integration branch weekly. That keeps the final merge small and exposes new `DatabaseSync` usages early.
- **The Node pilot must keep working on every commit.** `npm run check` and `npm test` stay green throughout. The integration branch merges to `main` only after the staging rehearsal passes (issue 15).
- After cutover, a cleanup issue retires the Node production entry (issue 17).
- First execution step: write `.scratch/cloudflare-deployment/PRD.md`, `map.md`, and `issues/NN-*.md`. Follow `docs/agents/issue-tracker.md`: `Type:`, `Status:`, `Blocked by:`, and the Definition of Done.

## Target architecture

```
Browser ──HTTPS──▶ Worker (apps/cloudflare/src/worker.ts)
                    ├─ Static Assets: /client.js /gallery.js /shortlet-foundations.css
                    └─ everything else ──▶ Durable Object "ShortletPilot" (idFromName(tenantId), locationHint "afr")
                                             ├─ ctx.storage.sql  ← DurableObjectSqlDatabase (SqlDatabase port)
                                             ├─ LocalGuestEnvironment + LocalApartmentOwnerEnvironment (existing code)
                                             ├─ guest + owner request handlers via node-http shim
                                             ├─ R2 "RECEIPTS" (private) via ReceiptBlobStore
                                             └─ alarm(): daily export → R2 "EXPORTS"
Outbound fetch: Paystack API, Gemini (@google/genai)       Inbound: POST /webhooks/paystack
```

## ADR compliance table (required by AGENTS.md)

| ADR | Constraint | Affected work |
|---|---|---|
| 0004 | Backend owns authoritative state | One Durable Object is the single system of record. No state in the Worker or the browser. |
| 0039 / 0041 / 0044 / 0046 | Atomic holds, payment windows, one live payment attempt | `transaction()` on the port must map to `ctx.storage.transactionSync`. Never hold a transaction across `await`. (Issues 02, 03) |
| 0065 | DPIA, vendor roles and retention are launch gates | Cloudflare and R2 become processors, and there is no Nigeria jurisdiction option. DPIA update in issue 14. |
| 0070 / 0075 | Server-bound identities; redaction; no secrets in logs; secure uploads; retention periods | R2 bucket private with opaque keys; Workers Logs must carry no cookies, tokens or bodies; durable audit (issues 06, 07, 13) |
| 0078 | en-NG, kobo, Africa/Lagos (WAT) display | Workers run in UTC. Confirm the `Intl` time-zone output matches Node in the spike (issue 01). |
| 0079 | Observable, replayable, no duplicate side effects | Telemetry must survive restarts (issue 06); PSP reference dedupe already durable |
| 0080 | Conventional no-JS routes keep parity | The shim must serve the full HTML routes and multipart forms unchanged (issue 09). |
| 0081 | Weaver host owns recovery | No change; Weaver bundles served as static assets |
| 0086 | Operator tokens hashed, never in URLs, 30-min, restart-safe sessions | Ops endpoints return tokens only in response bodies. Sessions stay in Durable Object SQLite. (Issue 11) |
| 0087 / 0088 | Paystack live client bound to public origin; transfers gated | The Cloudflare config loader keeps the `callbackBaseUrl === publicOrigin` check and `paystackTransfersEnabled` exactly. The webhook uses the raw body. |
| 0090 | Configured receipt limit; receipts are evidence only; seen only by the back office | R2 storage; the 5 MB default is kept; the read route stays back-office-authorized (issue 07). |
| **0095** | Record the hosting decision (renumbered from 0092 during integration) | Issue 14 |

## `cf` toolchain decision and ADR constraints

Use the project-pinned Cloudflare `cf` CLI as the standard interface for Workers development (`cf dev`), build/type generation (`cf build`, `cf workers types`) and deployment (`cf deploy`). Workers project configuration is `cloudflare.config.ts`; use `--mode staging` and `--mode production` for complete mode-specific configurations. Do not introduce Wrangler configuration as the project's primary configuration or document Wrangler as the normal developer workflow.

`cf` and its programmatic configuration are in beta. Slice 01c must verify the exact pinned CLI, Vite/plugin builder, Workers test harness, Durable Object SQLite, R2, static assets, generated types, mode handling and dry-run deployment before other Cloudflare slices rely on them. Prefer the Cloudflare Vite plugin as the build implementation so Wrangler is not an indirect production build dependency. If a confirmed capability gap requires Wrangler (for example, a Vitest/workerd harness implementation), document the exact gap and keep that dependency scoped to the affected test or fallback command. Do not invent CLI commands. Check current Cloudflare docs and record commands/versions in 01c; beta behavior may change.

The repository currently declares Node `>=22.13.0`; loading `cloudflare.config.ts` requires Node `>=22.18.0`. Slice 01c must raise the declared minimum to at least 22.18 and verify it. Install `cf` as a project devDependency and invoke the pinned project version. Use project-local `.dev.vars` for local bindings/secrets and never commit it. Since the documented CLI beta may not support setting one secret or streaming live logs, verify the current supported secret deployment and log inspection paths before writing runbook steps.

| ADR | Constraint | Affected `cf` work |
|---|---|---|
| 0004 | Backend owns authoritative state | Typed config and CLI bind the Worker to its Durable Object; domain authority stays out of configuration and client-side tooling. |
| 0065 | Hosting/vendor roles, cross-border transfer and retention are launch gates | 01c documents tool/runtime assumptions; 14 retains the Cloudflare vendor and DPIA review. |
| 0075 | Secrets and restricted interaction data stay out of logs | `.dev.vars`/secret workflow and Workers observability in 01c, 11a, 13 and 15. |
| 0080 | Critical workflows retain conventional deterministic parity | `cf dev` journey and staging acceptance exercise conventional guest/operator routes. |
| 0086 | Operator tokens are one-time, hashed, short-lived and never in URLs/logs | Ops provisioning and secret handling in 11a/11b and staging. |
| 0087 / 0088 | Paystack is environment-bound; webhook uses verified raw body; transfer capability is gated | Mode-specific secrets/config in 10b and signed webhook verification in 15. |

---

## Workstreams and issues

### 01 — Cloudflare toolchain and runtime spikes (Type: prototype)

#### 01c — Validate and pin `cf` (unblocked)

Before implementation depends on Cloudflare configuration, validate and pin the beta `cf` CLI, its build implementation and Node requirement. See `.scratch/cloudflare-deployment/issues/01c-cf-toolchain-foundation.md` for the throwaway Worker and acceptance criteria. Use `cf init`, `cf dev`, `cf build`, `cf deploy --dry-run` and `cf workers types`. Establish whether Durable Object SQLite, local R2, assets, modes and the Workers test harness work in this repository. A Wrangler-backed test harness is acceptable only as a documented internal test dependency, not as the preferred developer/deploy CLI.

#### 01a–01b — Runtime compatibility

Build a throwaway Worker using the pinned `cf` workflow and confirm each assumption the plan relies on:
- numbered `?1` parameters in `sql.exec`
- multi-statement `exec` for the `CREATE TABLE …; CREATE INDEX …` blocks
- whether `PRAGMA table_info` and foreign-key enforcement are allowed
- BLOB round-trip type (`ArrayBuffer` vs `Uint8Array`)
- nesting behaviour of `transactionSync`
- `@google/genai`, `createHmac`/`timingSafeEqual`, and `isIP` under `nodejs_compat`
- `Intl.DateTimeFormat(..., {timeZone:"Africa/Lagos"})` output
- Worker→Durable Object streaming of a 5 MB multipart body

Record the answers under `## Answer`. Later issues depend on them.

### 02 — `SqlDatabase` port and Node adapter; convert every store (Blocked by: —)

- New `packages/platform-core/src/sql-database.ts` with typed interfaces and no `any`:
  - `SqlValue = string | number | bigint | null | Uint8Array`
  - `SqlRow = Record<string, SqlValue>`
  - `SqlStatement { get(params?): SqlRow | undefined; all(params?): SqlRow[]; run(params?): { changes: number } }`
  - `SqlDatabase { prepare(sql): SqlStatement; exec(sql): void; transaction<T>(fn: () => T): T; close(): void }`
- `NodeSqliteDatabase` goes in a separate module that the Worker bundle never imports, e.g. `packages/platform-core/src/node-sqlite-database.ts`:
  - it wraps `DatabaseSync`;
  - `transaction` performs `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`;
  - it sets `PRAGMA busy_timeout` and `foreign_keys` once when opened.
- Mechanically convert the 11 domain stores to accept a `SqlDatabase`. Representative files:
  - `domains/shortlet/src/availability-store.ts`
  - `guest-interaction-store.ts`
  - `booking-state.ts`
  - `booking-payment-journey.ts`
  - `bank-transfer.ts`
  - `manual-transfer.ts`
  - `owner-payable.ts`
  - `checkin-support.ts`
  - `guest-contact.ts`
- The conversion changes for those stores:
  - Replace the hand-rolled `#tx` / `BEGIN IMMEDIATE` blocks with `db.transaction(fn)`.
  - Remove per-store `PRAGMA busy_timeout`.
  - Narrow row reads with guards instead of `as` casts where they are touched.
- **Stores that open their own connection from a path** must take the shared handle instead:
  - `SqliteOperatorRepresentativeGrantStore` (`operator-representative-authority.ts:144`)
  - `SqliteOperatorSessionAuthority` (`operator-session-authority.ts:22`)
  - the path-first constructors of `SqliteAvailabilityStore` and `SqliteGuestInteractionStore`
  - Drop the `databasePath` fields, or make them optional labels. First check what reads them.
- Tests: the whole existing suite stays green on the Node adapter. That is the acceptance bar.

### 03 — `DurableObjectSqlDatabase` adapter and contract suite (Blocked by: 01, 02)

- `apps/cloudflare/src/do-sql-database.ts` wraps `ctx.storage.sql` and `ctx.storage.transactionSync`.
- It translates `$name` to positional parameters with a small tokenizer that skips quoted literals. Cache the translation per SQL string.
- It normalizes BLOBs to `Uint8Array` and makes `changes` equal `cursor.rowsWritten`.
- `exec` of PRAGMAs that the Durable Object rejects becomes a no-op, per the spike's findings.
- Guard the limits: fail loudly when a query binds more than 100 parameters or a value exceeds 2 MB.
- Shared contract tests live in `test/helpers/sql-database-contract.ts`, following the AGENTS.md rule against duplicated fixtures:
  - they run under `node --test` against the Node adapter;
  - they run under a new `npm run test:workers` script (vitest-pool-workers) against the Durable Object adapter;
  - they cover named parameters, rollback on throw, BLOBs, and a concurrent-hold conflict.

### 04 — Composition roots take injected dependencies (Blocked by: 02)

- `LocalGuestEnvironment` (`apps/local-guest/src/fixture.ts:250-330`) and `LocalApartmentOwnerEnvironment` (`apps/local-owner/src/local-owner-environment.ts:422-470`) take these as config:
  - `database: SqlDatabase`
  - `unitRepository`
  - `operatorRepository`
- They keep a Node convenience factory that opens a file (`mkdirSync` + `NodeSqliteDatabase`) so the CLIs and tests are unchanged.
- `close()` must not close a handle the environment does not own.
- The guest server's per-session runtimes (`runtimeForSession`, `apps/local-guest/src/guest-server.ts:~3250`) today build a new environment, and a new connection, per browser session in an unbounded `Map`:
  - Share the single handle across them.
  - Add a bounded LRU eviction. This is safe because guest state is durable (restart-persistence work), but it is essential because Durable Object memory is 128 MB.

### 05 — SQLite-backed inventory and operator repositories (Blocked by: 02)

- Add `SqliteUnitRepository` and `SqliteOperatorRepository`, implementing the same interfaces as `JsonUnitRepository` (`domains/shortlet/src/browse.ts`) and `JsonOperatorRepository` (`domains/shortlet/src/operator.ts`).
- Loading reuses the existing `importInventoryCsv` (`inventory-import.ts`) and `bootstrapOperatorsFromUnitRepository`.
- The JSON repositories remain for local dev and fixtures.
- Watch for:
  - repositories that cache `findAll()` in memory; invalidate on write;
  - publication eligibility (ADRs 0008, 0009, 0056), which must be evaluated lazily against the clock, not frozen at load.

### 06 — Persist state that is only in memory on the operator side (Blocked by: 02)

This is a production gap independent of Cloudflare, but Durable Object eviction makes it lose data regularly.
- `InMemoryAuditLog` (`packages/platform-core/src/index.ts:7`, which uses `any`): add a typed, append-only `SqliteAuditLog`. Redact per ADR 0075.
- `InMemoryTelemetry`: persist redacted events and emit to Workers Logs.
- `InMemoryRevenueAccountingRepository`: add a SQLite implementation.
- `RevenueReleaseManager` and `OperatorEnforcementManager`: audit which state they hold and persist it.
- `#demoRequests`: confirm it is never used in production, and exclude it.
- Add a restart test mirroring `test/guest-process-restart.test.ts` and `test/helpers/guest-restart.ts` for the operator side.

### 07 — Receipts to R2 (Blocked by: 02)

- Add a `ReceiptBlobStore` port with `put(key, bytes, contentType)`, `get(key)` and `delete(key)`:
  - `SqliteReceiptBlobStore` keeps the current `manual_transfer_receipts.bytes` behaviour for Node and local use;
  - `R2ReceiptBlobStore` is for Cloudflare.
- `SqliteManualTransferStore.saveReceipt/readReceipt` (`manual-transfer.ts:158-170`) store metadata only on Cloudflare:
  - add columns `object_key` and `size_bytes`;
  - make `bytes` nullable through an additive migration.
- Write order: R2 `put` first, then the SQLite row inside the transaction. A daily alarm deletes orphaned objects (issue 12).
- Keys are random and opaque, never the booking reference.
- The bucket has no public access. Receipts are only streamed through the existing back-office route.
- Keep `DEFAULT_RECEIPT_MAX_BYTES` (5 MB) and enforce it before the body is read (`guest-server.ts:3461-3484`).

### 08 — Extract request handlers; dispatch in-process instead of proxying (Blocked by: 04)

- Split `startLocalGuestServer` (`guest-server.ts`) and `startLocalOwnerServer` (`local-owner-server.ts:1559`) into:
  - `createGuestRequestHandler(options)` and `createOwnerRequestHandler(options)`, which return `(req, res) => Promise<void>`;
  - thin Node `startX` wrappers that still `createServer` for tests and CLIs.
- Type `req`/`res` against narrow `HttpRequestLike`/`HttpResponseLike` interfaces that cover only what the handlers use, so `tsc` catches anything the shim would miss. Used today:
  - `req`: `method`, `url`, `headers`, the `data`/`end`/`error` events, `resume`
  - `res`: `writeHead`, `setHeader`, `end`, `headersSent`, `destroy`, `statusCode`
- Add `createPilotRequestHandler(configuration, deps)` in `apps/pilot/src/`. It dispatches `/operator*` to the owner handler and everything else to the guest handler, in-process. `/healthz` runs `SELECT 1` on the shared handle.
- This replaces `proxyRequest` to `127.0.0.1` ports (`pilot-server.ts:35-55`), and `pilot-server.ts` becomes a Node wrapper over it.

### 09 — Node-HTTP shim and static assets (Blocked by: 08)

- `apps/cloudflare/src/http-shim.ts` converts:
  - a Web `Request` into an `HttpRequestLike`: lower-cased headers, body chunks emitted as `Buffer`, and a `resume()` that drains the rest;
  - an `HttpResponseLike` into a Web `Response`: multiple `Set-Cookie` via `Headers.append`, and `destroy()` returns a 500.
- Build: extend `apps/local-guest/scripts/build-client.mjs` to write `client.js`, `gallery.js` and `shortlet-foundations.css` into `apps/cloudflare/public/`. Add a `_headers` file to keep today's `Cache-Control`.
- Replace the module-level `readFileSync` of CSS (`guest-server.ts:105`, `local-owner-server.ts:37`) and of the client scripts (`guest-server.ts:3369-3380`) with an injected `assets` loader:
  - Node reads files;
  - Cloudflare uses the asset/import mechanism validated in 01c; do not add Wrangler-specific module imports without confirming they work in the selected `cf` build pipeline.

### 10 — Worker + Durable Object scaffold and configuration (Blocked by: 03, 04, 05, 09)

- New `apps/cloudflare/` containing `cloudflare.config.ts`, `src/worker.ts`, `src/shortlet-pilot-do.ts` and `src/cloudflare-config.ts`.
- `cloudflare.config.ts`, using pinned `cf/config` helpers and typed bindings:
  - `nodejs_compat` and a current compatibility date;
  - Durable Object binding `SHORTLET`, with SQLite storage and the migration/export configuration required by the selected `cf` beta;
  - R2 buckets `RECEIPTS` and `EXPORTS`;
  - static asset build/output configuration;
  - vars: `SHORTLET_PUBLIC_ORIGIN`, `SHORTLET_TENANT_ID`, `SHORTLET_PAYSTACK_TRANSFERS`, `SHORTLET_MANUAL_TRANSFER_*`, `SHORTLET_RECEIPT_MAX_BYTES`, `CONCIERGE_MODE`, `GEMINI_MODEL`;
  - secrets: Paystack keys and `GEMINI_API_KEY`;
  - complete, explicit `staging` and `production` configurations selected by `--mode`.
- `cloudflare-config.ts` mirrors `loadPilotConfiguration` (`apps/pilot/src/pilot-config.ts`):
  - it reuses `paystackTransfersEnabled`, `manualTransferAccount`, `receiptMaxBytes`, `publicOrigin` (export it) and `loadPaystackConfiguration`, passing an explicit source, not `process.env`;
  - it drops the file-path checks;
  - it reads operator and unit data from SQLite (issue 05).
- The Durable Object constructor, inside `ctx.blockConcurrencyWhile`:
  1. creates `DurableObjectSqlDatabase`;
  2. runs schema creation;
  3. builds both environments with `production: true` and live Paystack, as `startPilotServer` does today;
  4. builds `createPilotRequestHandler`.
- `fetch()` runs the shim, then the handler.
- The Worker forwards to `idFromName(tenantId)` with `locationHint: "afr"`.

### 11 — Operations endpoints and CLI (Blocked by: 05, 10)

The current CLIs mutate local files or the SQLite file directly:
- `pilot:operator:*` and `pilot:inventory:import` (`apps/shortlet-ops/src/`)
- `operator:provision` / `operator:revoke` (`apps/local-owner/src/cli-*.ts`)
- `pilot:local:*`

Replace them with `/_ops/*` routes on the Durable Object:
- The routes are protected by **Cloudflare Access service tokens**, and also by a shared-secret header that is checked fail-closed.
- Make the existing CLIs call them over HTTPS when `SHORTLET_OPS_URL` is set.
- ADR 0086: provisioned access tokens are returned only in the response body, never in URLs or logs.
- Inventory import sends the CSV as the request body.

### 12 — Backups, export and restore runbook (Blocked by: 07, 10)

- Document point-in-time recovery for Durable Object SQLite (30 days: `getBookmarkForTime` / `onNextSessionRestoreBookmark`) as a restore runbook, and rehearse it on staging.
- A daily Durable Object `alarm()`:
  - exports the audit, booking, payment and payout tables as JSONL to R2 `EXPORTS` (retention per ADR 0075, which is provisional);
  - sweeps orphaned receipt objects.

### 13 — Observability and edge security (Blocked by: 10)

- Enable Workers Logs using the `cloudflare.config.ts` observability setting validated in 01c. The handlers keep logging nothing about requests (ADR 0075).
- Add a test asserting that no cookie, token or authorization value reaches `console`.
- Add WAF rate-limit rules for `POST /operator/login` and `/webhooks/paystack`.
- Use a custom domain with HTTPS only; keep the app's own security headers.

### 14 — ADR 0095 and DPIA update (Type: grilling, human review)

- Write `docs/adr/0095-host-the-pilot-on-cloudflare.md`, covering:
  - a single Durable Object per tenant;
  - R2 for evidence;
  - no Nigerian data-residency option (placement is only a hint);
  - sharding by tenant later.
- Update the ADR 0065 launch-gate items: vendor roles, cross-border transfer, and retention for Cloudflare and Google Gemini.

### 15 — Staging rehearsal (Blocked by: 06, 07, 10, 11, 12, 13)

- Deploy `staging` with Paystack **test** keys.
- Run the launch journey against the staging URL: the adapted `scripts/pilot-agent-smoke.ts`, the Rodney acceptance script, and the real-Chrome guest journeys.
- Force Durable Object restarts mid-journey (redeploy or eviction) and prove every stage resumes: discovery → offer → payment → confirmed, plus operator sessions.
- Run Paystack webhook and card callback end-to-end, and a manual-transfer receipt upload, read and verify.
- Merge `infra/cloudflare-deployment` → `main` only when this passes.

### 16 — Data migration and cutover (Blocked by: 15)

- If the Node pilot has live data, run a one-off exporter over the Node SQLite file to per-table JSONL, then import it through a `/_ops/import` route in batches that respect the 100-parameter limit. Verify row counts and checksums.
- Cutover runbook:
  1. Freeze Node writes.
  2. Migrate the data.
  3. Update the Paystack dashboard callback and webhook URLs if the origin changes.
  4. Switch DNS.
  5. Run the smoke tests.
- Rollback window: DNS back to Node plus a reverse export of anything written after cutover.

### 17 — Retire the Node production entry (Blocked by: 16)

- Remove `apps/pilot/src/pilot-server.ts` and `cli-start.ts` as a production path, and the matching `pilot:start` script.
- Keep `NodeSqliteDatabase` and the Node wrappers for local dev and tests.
- Document `cf dev` as the production-parity local run.

---

## Implementation watch-outs

- **Never `await` inside `db.transaction(fn)`.** `transactionSync` enforces this. While the Durable Object awaits a Gemini or Paystack `fetch`, other requests interleave, the same as the Node event loop today. The assistant runtime's post-commit reconciliation (`apps/local-guest/src/assistant/assistant-runtime.ts:604/705/778`) already assumes this. Keep it that way.
- **The Worker clock does not advance during synchronous execution.** `Date.now()` moves only across I/O. Deadline logic is lazy, which is fine, but any code measuring elapsed time within a single request will see zero.
- **Durable Object limits:** 2 MB per row or value, 100 bound parameters, 100 columns, 100 KB per statement, 10 GB per object, 128 MB memory, and a soft limit of 1,000 requests per second. Watch the size of the `guest_threads.thread_json` projection, and any `IN (...)` lists built from arrays.
- **Eviction is a normal restart.** Anything kept in module-level or instance memory that is not re-derivable from SQLite is a bug (issue 06).
- **Do not bundle `node:sqlite`** into the Worker. It is a non-functional stub there. Keep the Node adapter module out of the Worker import graph, and add a CI check such as an esbuild metafile assertion.
- **`process.env`:** `paystack.ts:34` defaults to `process.env`. On Cloudflare, pass the env explicitly rather than relying on `nodejs_compat_populate_process_env`.
- **Webhooks must verify the exact raw bytes.** The shim must not decode and re-encode the body.
- **Coding standards:** no `any` in new ports or adapters, fail-closed checks on ops auth, and no invented policy constants. Limits come from configuration or ADRs.

## Verification

- For every PR:
  - `npm run check` and `npm test` stay green (Node adapter);
  - `npm run test:workers` runs the adapter contract tests and Durable Object integration tests in workerd;
  - `cf build` and `cf deploy --dry-run` validate the Worker build without uploading it;
  - the Definition of Done in `docs/agents/issue-tracker.md` is checked item by item.
- Local parity: `cf dev` against local Durable Object and R2 simulation. Drive the guest journey in the preview browser, and exercise `/operator` login with a token provisioned through the ops CLI.
- Staging: the issue 15 rehearsal, including forced restarts, the Paystack test-mode webhook and callback, receipt upload to R2, and a point-in-time-recovery restore drill.
- Production: the issue 16 cutover smoke checklist, with the rollback window defined before DNS is switched.

Rough effort: 3–4 engineer-weeks. Issues 02, 05, 06 and 07 can run in parallel once 02's port interface lands.

---

## Code reference corrections (2 Oct 2026)

The workstreams above are cut into one-session slices in `map.md` and `issues/`, and the slices use the corrected references below. When a slice and this PRD disagree, follow the slice.

- `DatabaseSync` is used in **17** production files, not 16: 11 domain files and 6 app files. The app files the PRD missed open their own connections:
  - `PilotNotifier` (`apps/pilot/src/notifications/pilot-notifier.ts:123`)
  - `apps/pilot/src/local-pilot.ts:49,57`
  - both healthchecks (`pilot-server.ts:29`, `local-pilot-server.ts:60`)
  - `LocalBookingContractRepository` (`apps/local-guest/src/fixture.ts:178`), which also uses `BEGIN IMMEDIATE`
- `PRAGMA foreign_keys = ON` is set only in the guest environment (`fixture.ts:262`). `busy_timeout` is also set by the availability and interaction stores even when they are given a shared handle.
- Current `guest-server.ts` lines:
  - `startLocalGuestServer`: :6515
  - `runtimeForSession`: :6651
  - receipt limit: :7403 and :7480–7495
  - CSS read: :221
  - client scripts: :7059, :7081, :7102
- The session runtime Map is **not** unbounded. Idle eviction exists (`sessionRuntimeIdleMs`, `evictIdleRuntimes`); what is missing is a size cap.
- Other locations:
  - `startLocalOwnerServer`: `local-owner-server.ts:1187`
  - `proxyRequest`: `pilot-server.ts:52–80`
  - `DEFAULT_RECEIPT_MAX_BYTES`: `apps/local-guest/src/fixture.ts:47`
- `build-client.mjs` produces four bundles: `gallery.js`, `offer.js`, `payment.js` and `client.js`.
- `JsonUnitRepository` implements no interface (`findAll(): any[]`), so one must be extracted first (slice 05a).
- The pilot server also owns the rate limiters, the beta banner, client addressing and the notifier sweep, and these must be kept (slices 08c and 10b).
- Tooling:
  - The root `tsconfig.json` includes `apps/**/*` with Node types, so `apps/cloudflare` needs its own tsconfig.
  - `scripts/run-tests.mjs` reads only top-level `test/*.test.ts` (slice 03a).
