# Map: Cloudflare deployment

PRD: `PRD.md` (see its "Code reference corrections" section; the slices carry the corrected `file:line` references).

The 17 PRD workstreams are cut into **slices** numbered `NNx`. `NN` is the PRD workstream, so `02c` is the third slice of workstream 02. Slice 01c validates the `cf` CLI toolchain before runtime spikes and the Workers test harness.

## Slice rules

Each slice:

- **Fits one agent session.** About a day of work, a bounded list of files, and five acceptance criteria or fewer.
- **Leaves the repo green.** `npm run check` and `npm test` pass, and the Node pilot still runs. No slice ends half-migrated: if a converted type is used somewhere, every use is converted in the same slice.
- **Delivers something verifiable on its own**, such as a new port, a converted group of stores, or a green test suite. The "Unlocks" column says what it makes possible next.
- **Stays inside its "Out of scope" list.** If the work spills over, stop and note it in `## Comments` instead of growing the slice.

## Branching

- Integration branch: `infra/cloudflare-deployment`, cut from `main` in slice 01a. Never cut it from `ui/listing-gallery`.
- Each slice gets a branch `infra/cf-<NNx>-<slug>`, with one PR into `infra/cloudflare-deployment`, never into `main`.
- Merge `main` into the integration branch weekly. After each merge, grep for new `DatabaseSync` or `node:sqlite` uses outside `packages/platform-core/src/node-sqlite-database.ts`.
- The integration branch merges to `main` only after slice 15 passes.

## Workflow

The frontier is the first slice in the table that is open, unblocked and unclaimed. **Lanes can run in parallel**: once 02a lands, several agents can each take the frontier of a different lane.

1. Claim the slice: set `Status: claimed`.
2. Follow the AGENTS.md implementation protocol. Read the ADRs listed in the slice and write one failing test per acceptance criterion.
3. Implement, then run `npm run check`, `npm test`, and `npm run test:workers` once it exists (slice 03a). Use `cf dev` for local Workers development and `cf build` / `cf deploy --dry-run` for build validation. The browser phase of `npm test` takes about 12 minutes, so run it in the background.
4. Check the Definition of Done in `docs/agents/issue-tracker.md` item by item.
5. Commit on the slice branch and open the PR into the integration branch.
6. Write `## Answer`, set `Status: resolved`, and add a context pointer below.

## Slices

| # | Slice | Type | Status | Blocked by | Unlocks |
| --- | --- | --- | --- | --- | --- |
| **A: Foundation** | | | | | |
| 01a | Cut the integration branch; spike Durable Object SQL semantics | prototype | resolved | none | 01c, 01b, 03a |
| 01c | Validate and pin the `cf` Workers toolchain | prototype | resolved | 01a | 01b, 03a |
| 01b | Spike Workers runtime compatibility | prototype | resolved | 01a, 01c | 09c, 10b |
| 02a | `SqlDatabase` port, Node adapter, contract helper | task | resolved | none | 02b–02d, 03b, 05b, 06a–06c |
| 02b | Move the seven handle-taking stores onto the port | task | resolved | 02a | 02e, 07a |
| 02c | Move the availability and guest-interaction stores onto the port | task | resolved | 02a | 02e |
| 02d | Move the operator grant and session stores onto the shared handle | task | resolved | 02a | 02e |
| 02e | Move the app layer onto the port; guard `node:sqlite` imports | task | resolved | 02b, 02c, 02d | 04a, 04b |
| **B: Workers harness** | | | | | |
| 03a | Workers test harness and `apps/cloudflare` skeleton | task | resolved | 01a, 01c | 03b, 07b, 09b, 09c |
| 03b | `DurableObjectSqlDatabase` passing the shared contract | task | resolved | 02a, 03a | 10b |
| **C: Composition and repositories** | | | | | |
| 04a | Injectable guest composition root | task | resolved | 02e | 04c, 08a |
| 04b | Injectable owner composition root | task | resolved | 02e | 06d, 08b |
| 04c | Session runtimes share one handle, with a size cap | task | resolved | 04a | 10b |
| 05a | Typed unit repository interface | task | resolved | none | 05b |
| 05b | SQLite unit and operator repositories | task | resolved | 02a, 05a | 10a |
| **D: Durable state** | | | | | |
| 06a | Durable, typed, redacted audit log | task | resolved | 02a | 06d |
| 06e | Durable reserve-payout state (admin holds, tranches, idempotency) | task | resolved | 06c, 06d | 15 |
| 06b | Durable, redacted telemetry | task | resolved | 02a | 06d |
| 06c | Durable revenue accounting and release state | task | resolved | 02a | 06d |
| 06d | Durable enforcement and booking state; operator restart test | task | resolved | 04b, 06a, 06b, 06c | 15 |
| 07a | `ReceiptBlobStore` port, SQLite implementation, migration | task | resolved | 02b | 07b |
| 07b | R2 receipt store | task | resolved | 03a, 07a | 10b, 12a |
| **E: HTTP** | | | | | |
| 08a | Narrow HTTP types; extract the guest request handler | task | ready-for-agent | 04a | 08b, 09c |
| 08b | Extract the owner request handler | task | ready-for-agent | 04b, 08a | 08c |
| 08c | In-process pilot handler; remove the localhost proxy | task | ready-for-agent | 08b | 09a, 10b |
| 09a | Injected asset loader | task | ready-for-agent | 08c | 09b |
| 09b | Build static assets for Cloudflare | task | ready-for-agent | 03a, 09a | 10b |
| 09c | Fetch-to-node-HTTP shim | task | ready-for-agent | 01b, 03a, 08a | 10b |
| **F: Cloudflare assembly** | | | | | |
| 10a | Cloudflare configuration loader | task | resolved | 05b | 10b |
| 10b | Worker, Durable Object and typed `cf` config, running on `cf dev` | task | ready-for-agent | 01b, 03b, 04c, 07b, 08c, 09b, 09c, 10a | 11a, 12a, 12b, 13 |
| 11a | `/_ops` authentication and operator routes | task | ready-for-agent | 10b | 11b |
| 11b | Inventory import route; CLIs over HTTPS | task | ready-for-agent | 11a | 15 |
| 12a | Daily export and orphan-receipt sweep alarm | task | ready-for-agent | 07b, 10b | 15 |
| 12b | Restore runbook | task | ready-for-agent | 10b | 15 |
| 13 | Observability and edge security | task | ready-for-agent (the dashboard steps need a human) | 10b | 15 |
| 14 | ADR 0095 and DPIA update | grilling | resolved (architecture accepted; external gates open) | none | 15 |
| **G: Release** | | | | | |
| 15 | Staging rehearsal; merge to `main` | task | ready-for-human | 06d, 11b, 12a, 12b, 13, 14 (cross-border, contracts and retention gate) | 16 |
| 16 | Data migration and cutover | task | ready-for-human | 15 | 17 |
| 17 | Retire the Node production entry | task | ready-for-agent | 16 | none |

**What can run at once.** Slices 01a, 02a, 05a and 14 have no blockers. After 01a lands, 01c can start; after 01c lands, 01b and 03a can proceed. After 02a lands, 02b, 02c, 02d, 06a, 06b and 06c can all run in parallel. After 02a and 03a land, 03b can start.

## Delivery waves (one wave per implementation session)

Waves are session-sized batches of slices, not replacements for the `Blocked by` graph. A session may implement only the unblocked slices listed for its wave; do not wait for unrelated slices in the same wave when their own dependencies are satisfied. Merge each completed slice into `infra/cloudflare-deployment` before starting a dependent slice. If a slice is still blocked, leave it for the next session rather than widening the batch.

| Wave | Session focus | Issues | Start when | Handoff / exit gate |
| --- | --- | --- | --- | --- |
| **1 — Foundation** | Establish integration branch, validate Cloudflare SQL, pin and prove the `cf` toolchain, and land the common SQL port and repository seam. | 01a, 01c, 02a, 05a, 14 (human review can proceed in parallel) | Start with 01a, 02a and 05a; 01c follows 01a. Start human review for 14 early. | 01a establishes `infra/cloudflare-deployment`; 01c records pinned `cf` versions/commands and verified capabilities; 02a provides `SqlDatabase`; 05a provides the repository contract. ADR 0095/DPIA decision from 14 is recorded before release wave 6. |
| **2 — Parallel persistence and harness** | Convert existing stores and prove the Workers runtime/database adapter; establish SQLite repositories and durable audit/telemetry/revenue. | 01b, 02b–02d, 03a, 03b, 05b, 06a–06c | 01b and 03a after 01a/01c; 02b–02d and 06a–06c after 02a; 03b after 02a/03a; 05b after 02a/05a. | `npm run check`, `npm test` and `npm run test:workers` pass; Node adapter and `DurableObjectSqlDatabase` both pass the shared SQL contract; runtime assumptions and test-harness/tooling limits are documented. |
| **3 — Composition and durable services** | Inject dependencies into guest/owner compositions, share the DB handle, complete restart-safe operator state, and move receipts to R2. | 02e, 04a–04c, 06d, 07a–07b, 10a | 02e after 02b–02d (02e also converts the Guest Account authority, `domains/shortlet/src/guest-account-authority.ts`, to `SqlDatabase` before its import guard can pass; see the 5 Oct 2026 comment in issue 02e); 04a/04b after 02e; 04c after 04a; 06d after 04b/06a–06c; 07a after 02b then 07b after 03a; 10a after 05b. | Both environments consume injected dependencies; restart and repository contracts pass; receipt storage and Cloudflare configuration loader are ready for assembly. |
| **4 — HTTP and asset adaptation** | Make existing handlers runnable without Node servers/filesystem and prepare Workers HTTP/assets. | 08a–08c, 09a–09c | 08a after 04a; 08b after 04b/08a; 08c after 08b; 09a after 08c; 09b after 03a/09a; 09c after 01b/03a/08a. | Handler, asset and Fetch-shim tests pass; Node wrappers and conventional routes preserve behavior; no Wrangler-only asset assumptions remain. |
| **5 — Cloudflare assembly and operations** | Integrate the Worker/Durable Object, operations APIs, backup/restore and edge security. | 10b, 11a–11b, 12a–12b, 13 | 10b after 01b, 03b, 04c, 07b, 08c, 09b–09c and 10a. Then 11a/12a/12b/13 after 10b; 11b after 11a. Human dashboard/DNS steps in 13 are coordinated with the user. | Full local journey passes on `cf dev`; `cf build` / dry-run succeeds; ops, persistence, backups, restore and security checks are ready for staging. |
| **6 — Release and retirement** | Rehearse staging, migrate production data, cut over, then remove the Node production entry. | 15–17 | 15 after 06d, 11b, 12a–12b, 13 and 14; 16 after 15; 17 after 16. | Staging evidence, migration/cutover and rollback checks are recorded; Cloudflare is production and Node remains only for local development/tests. |

### Session handoff checklist

At the beginning of a wave session:

1. Read the wave row, each selected issue, its `Blocked by` list, and the relevant ADRs.
2. Select only issues in that wave whose blockers are merged and whose scope fits the session. Resolve any user-owned decisions before implementing their dependent issue.
3. Run the issue's acceptance checks and the shared checks in the workflow above.
4. Merge completed slices to the integration branch and record each result in the issue's `## Answer` and the context pointers below. The next session starts from the updated map and the next wave's still-open frontier.

**Change from the PRD.** Slice 14 blocks 15, so the hosting ADR exists before the integration branch merges to `main`.

## Wave 3 approved configuration decisions

The user approved both recommendations in this implementation session:

- Production session-runtime cap: **32**, configurable; local/unset behavior remains uncapped. This is an initial engineering limit, not a measured capacity guarantee. 04c supplies LRU eviction and durable reconstruction; 10b wires the production configuration.
- Empty first boot: normal application routes and `/healthz` return **503 “not provisioned”** until valid inventory and tenant-matching operators exist. Authenticated provisioning remains available. No fallback to demo data. 10a records configuration/readiness policy; HTTP enforcement is wired in assembly (10b/11a/11b).

## Values to ask the user, not invent

- 02e: whether to fix owner fixture data or turn off `foreign_keys` for the owner database, if turning it on breaks an owner fixture.
- 04c: answered above (32 for production; local/unset remains uncapped).
- 10a: answered above (503 “not provisioned”; authenticated provisioning available).
- 11a: the name of the shared-secret header, and how the secret is provisioned.
- 11b: the body-size limit for inventory CSV import.
- 12a: export retention (ADR 0075 is provisional), and the grace period before an orphaned receipt is swept.
- 13: WAF rate-limit thresholds for `POST /operator/login` and `/webhooks/paystack`.

## Things the PRD missed (now in the slices)

- The pilot server does more than proxy. It also runs rate limiters, a beta banner, rightmost-`X-Forwarded-For` client addressing and a `setInterval` notifier sweep. Slice 08c keeps all of these. On Cloudflare, `CF-Connecting-IP` replaces the client-address source (09c), and the sweep becomes an alarm (10b).
- The in-memory rate limiters reset whenever the Durable Object is evicted, so edge WAF rules back them up (13).
- The guest environment also keeps its audit and telemetry in memory (`fixture.ts:275–276`), not just the owner side (06a, 06b).
- `loadPilotConfiguration` also reads `SHORTLET_DEPLOYMENT`, `SHORTLET_BETA_INVITE_CODE`, the pilot limits and the notification settings, which the PRD's var list leaves out (10a).

## Kickoff prompt for a new session

> Implement the Cloudflare deployment effort in `.scratch/cloudflare-deployment/`. Read `PRD.md`, then `map.md`. Work on one delivery wave per session: take the next unblocked wave (or the wave I name), select only its unblocked slices, and follow the AGENTS.md implementation protocol and each slice's own file. Use pinned `cf` commands as the primary Workers development, build and deployment workflow; use Wrangler only for a documented capability gap or as a test harness implementation dependency.
>
> - Work on `infra/cf-<NNx>-<slug>` cut from `infra/cloudflare-deployment`, and open the PR into that branch.
> - Stay inside the slice's "Out of scope" list. Keep the Node pilot and `npm test` green.
> - Don't invent policy values; ask me. When done, check the Definition of Done item by item, then write `## Answer` and a context pointer in `map.md`.

## Wave 2 session handoff (5 Oct 2026 — historical)

Superseded by the continuation below; its status descriptions are historical.

Started from `infra/cloudflare-deployment` at `d4eefe5`; selected the unblocked, bounded slices **03a and 02b**. Both completed on their own branches and were validated before integration. **Wave 2 remains open**: 01b, 02c, 02d, 05b and 06a–06c are still unclaimed/unblocked and were not attempted in this batch. No Wave 3 implementation was taken; 02e still waits for 02c/02d. Issue 03b is unlocked by 03a but is not listed in this wave's slice set and was not silently added.

Final stable checks: `npm run check`, `npm run test:workers` (1 workerd test), full Node suite (1,268 non-browser + 165 browser tests passed; zero failures; one expected skip), and whitespace checks. See issue answers for the environment-variable caveat and transient Chromium focus failure/retry evidence. No production Cloudflare app/config, deployment, or staging rehearsal is claimed. The Guest Account authority is explicitly part of 02e's twelve-file domain persistence inventory and future repo-wide guard, not one of 02b's seven converted stores.

## Wave 2 continuation (6 Oct 2026 — historical; superseded below)

Completed and integrated **01b, 02c, 02d, 03b and 05b**. The current Wave 2 row explicitly includes 03b, superseding the older handoff's scheduling gap. **Wave 2 remains open: 06a, 06b and 06c remain ready-for-agent and unimplemented.** Do not declare the wave complete or start Wave 3 on this record. No new policy decision blocks those three slices.

The misplaced `.scratch/cf-wave2-worktree` was moved outside the main repository and reconciled. Its seven dirty files were backed up and byte-verified; three formatting-only edits were removed after emitted-code comparison. Its completed operator code is committed and integrated, not stranded in an untracked folder. Recovery snapshots remain local under `cloudflare-deployment/recovery/`. After integration, its validation logs/generated test data were archived and the temporary sibling worktree was removed without force; both paths are gone and the branch remains recoverable.

Final checks on the integrated code: `npm run check` passes; `npm run test:workers` passes **14 workerd tests**, including all eight shared SQL contract cases; `npm test` passes **1,281 non-browser and 165 browser tests, zero failures, one expected skip**. Node tests unset `PI_REASONING_LEVEL` for the existing broad NIN environment assertion. A preceding full run had two Chrome DevTools startup failures, before app interaction; isolated retry and a complete subsequent full suite passed without a UI workaround. Evidence: `.scratch/cf-wave2-confirmed.log`, `cf-wave2-check.log`, `cf-wave2-workers.log`, `cf-wave2-chrome-retry.log`.

Runtime spike evidence is local only: `cf build`, `cf dev`, assertions and dry-run pass. Crypto/Intl match Node, Gemini uses mocked fetch, Buffer/isIP work, and a 5 MiB multipart upload is progressively consumed. Unlike the PRD assumption, the local synchronous loop's clock advances (3/8 ms); 10b must not depend on clock advancement inside atomic decisions. No hosted quota proof, staging/production deployment or real-person data processing is claimed.

## Direct durable-state continuation (6 Oct 2026)

06a is implemented and validated (`5303c68`): full suite 1,286 non-browser + 165 browser passes, zero failures, one expected skip; all compiler checks and 14 Workers tests pass. Shared redaction is extracted from the interaction security engine. No retention rule, export or production deployment added. 06b is implemented and validated (`cee7988`): full suite 1,290 non-browser + 165 browser passes, zero failures, one expected skip; compiler and 14 Workers tests pass. Events and unique hashed transition keys survive restart; no external sink is wired. 06c is implemented and validated (`502fcc1`): its full suite passed 1,311 non-browser + 165 browser tests, zero failures, one expected skip; compiler and 14 Workers tests pass. The pre-code audit covers every instance field, financial writes are atomic and integer-kobo, and both complete existing release suites run against both adapters. All three slices are resolved and integrated.

**Wave 2 is complete.** Final checks ran on the stable integrated snapshot `169ffe1`: `npm run check` passes; full `npm test` exits 0 with **1,311 non-browser and 165 browser tests passed, zero failures, one expected skip**; `npm run test:workers` passes **14 workerd tests** (including the unchanged eight-case shared SQL contract); whitespace checks pass. Evidence: `C:/AI2026/cf-wave2-durable-final.log` / `.exit` (0), `cf-wave2-durable-final-check.log`, `cf-wave2-durable-final-workers.log`. All four full suites in this continuation ran serially without a browser retry; tests unset the documented `PI_REASONING_LEVEL` environment variable. Runtime/toolchain caveats from the earlier continuation remain applicable.

No Wave 3 implementation, staging/production deployment, merge to `main`, orchestrator or delegated work. Delivery is committed locally on slice branches and merged into `infra/cloudflare-deployment`; no external PR was opened. New worktrees are outside the main repository (`chat-marketplace-cloudflare-06a`, `-06b`, `-06c-direct`) and share the integration dependency junction; existing worktrees and untracked scratch data are preserved. The next implementation batch is Wave 3, only when requested, including its recorded user-owned configuration decisions and launch gates.

## User-authorized early code merge to main (6 Oct 2026)

After Wave 2 validation, the user explicitly requested `merge to main`. Merge `33d8135` brings the validated foundation/Wave 2 code into `main` ahead of the original issue-15 release schedule. This is a **local code merge only**, not acceptance of staging, production, cutover, counsel, retention or vendor-contract gates; issue 15 remains ready-for-human and Waves 3–6 remain unimplemented. Existing main-only guest UI documentation is retained. The merged runtime/test/package trees are byte-identical to the fully tested integration branch; fresh compiler checks and 14 Workers tests pass (`C:/AI2026/cf-main-merge-{check,workers}.log`). No push or deployment is authorized by this record.

## Wave 3 partial handoff (historical)

Slice **10a** (`a3fdb15`) was completed first, with the user-approved cap/first-boot decisions recorded above (1,317 non-browser + 165 browser passes, 16 workerd tests). The rest of the wave is recorded below.

## Wave 3 completion (6 Oct 2026)

**Wave 3 is complete.** 02e, 04a, 04b, 04c, 06d, 07a and 07b are implemented and integrated into `infra/cloudflare-deployment` (`602a11e`, `fb7e199`, `ca19100`, `772d8a2`), on top of 10a.

Final checks on the integrated snapshot `772d8a2`: `npm run check` passes; full `npm test` exits 0 with **1,359 non-browser and 165 browser tests passed, zero failures, one expected skip**; `npm run test:workers` passes **22 workerd tests** (the 16 earlier plus 6 for R2 and the bounded body). Tests unset the documented `PI_REASONING_LEVEL` variable. Evidence: `C:/AI2026/cf-wave3-full.log` and `.exit` (0), `cf-wave3-check.log`, `cf-wave3-workers.log`. Per slice, the non-browser phase and the compiler were run before each commit; the browser phase ran once on the integrated snapshot rather than per slice.

What changed, in one line each:
- **02e:** the app layer and the Guest Account authority use `SqlDatabase`; `node-sqlite-database.ts` is the only production importer of `node:sqlite`, guarded repo-wide. The owner handle now enforces foreign keys; no fixture broke, so no user decision was needed.
- **04a/04b:** both environments take `(config, { database, unitRepository, ... })` and do no filesystem access; `openNode(config)` is the Node composition and owns its handle. The pilot servers inject one handle into both environments, so `startPilotServer` opens exactly one.
- **04c:** session runtimes share the live handle and inventory; `sessionRuntimeLimit` evicts least-recently-used runtimes. Unset means uncapped; the approved production value of 32 is for 10b to pass.
- **06d:** operator enforcement state lives on the shared handle (`SqliteOperatorEnforcementStateStore`); the policy suite runs against both stores; the operator restart test covers session, grant, request action, revenue, enforcement and audit. Owner `production` config makes demo requests unavailable.
- **07a/07b:** receipt bytes go through the async `ReceiptBlobStore` (SQLite for Node, R2 in the Worker), with an idempotent create-copy-rename migration that also runs on Durable Object SQL, opaque UUID keys, put-then-commit with a re-check after the await, and a bounded-body reader for the Worker.

Findings and decisions to carry forward:
- **Resolved by 06e:** `ReservePayoutManager` keeps `#tranches`, `#adminHolds` and `#executedCommands` in memory. Admin holds affect trust tier and payouts, so this needs its own audit and store before slice 15 (a follow-up task was raised).
- **02e AC2 deviation, resolved:** the one-handle check first asserted two, then one once 04a/04b injected a shared handle. Per-session guest runtimes were the last place that opened more; 04c closed that.
- **For 10b:** wire `R2ReceiptBlobStore(env.RECEIPTS)` into both environments' `receiptBlobs`, pass the 32 cap as `sessionRuntimeLimit`, call `readBodyWithLimit` before the multipart parse, build a `SqliteUnitRepository` / `SqliteOperatorRepository` (05b) as the injected repositories, and keep the 503 "not provisioned" first-boot behaviour. 09c must keep `content-length` and the stream.
- **For 12a:** there is no `list` on the receipt port; sweep orphans with the R2 binding directly (it has object upload times, the SQLite store does not).
- The owner server now awaits receipt reads and runs receipt retention before signed-in `GET /operator*` pages.
- Delivery is local on slice branches and the integration branch; no external PR, push, deployment, merge to `main` or staging claim. Wave 4 (08a–08c, 09a–09c) is the next batch, only when requested.

## Wave 4 completion (7 Oct 2026)

**Wave 4 is complete.** 08a, 08b, 08c, 09a, 09b and 09c are implemented, merged into `infra/cloudflare-deployment` and resolved.

| Slice | Implementation | Delivery record |
| --- | --- | --- |
| 08a guest handler | `f1ff86c` | `0f01fce` |
| 08b owner handler | `bb247a3` | `3469dde` |
| 08c pilot handler | `6c89dbc` | `c25983f` |
| 09a asset loader | `eb2a228` | `6319924` |
| 09b static assets | `c9237eb` (merge commit) | `eae5bd6` |
| 09c HTTP shim | `75ccc2d` | `cdcae50` |

Evidence on the integrated snapshot `cdcae50`:

- **Full serial `npm test`** (phase 1 concurrent, phase 2 real-browser serial) exited **0**. The verdict is in `C:/AI2026/cf-wave4-full.exit` (`EXIT=0`); background log capture produces 0-byte files on this machine.
- **Phase 1** was re-run in four foreground chunks: 337 + 342 + 409 + 293 = **1,381 tests, zero failures**.
- **`npm run test:workers`:** 27 tests in 5 files pass.
- **`npm run check`** (all four programs) and `git diff --check` are clean.
- **Pilot acceptance (08c AC5): PASS**, 29 of 29 scenarios. The Rodney journey was replayed in the Claude desktop in-app browser rather than through Rodney. Guest A, Guest B and Operator each had their own cookie host. The run covered:
  - Discovery and refinement, the generated Unit detail, the Request Draft, phone, review and submit.
  - Operator one-time token login and reuse refusal.
  - Confirmation, the Conditional Booking Offer, acceptance, the email gate, local deterministic payment, then exactly 1 Reservation and 1 Booking Contract.
  - Restart persistence.
  - Guest B's Lagos/Wuse location conflict, then its own request and decline.
  - Cross-Guest and Operator isolation probes, plus 390/320 reflow and target checks on discovery, detail, review and confirmed screens.

  Full record: `wave-4-acceptance.md`.

As in earlier waves, the browser phase and the acceptance journey ran once, on the integrated snapshot. The per-slice deferrals (08c AC5 and 09a AC4) are now discharged; each issue's Comments says so.

Findings to carry forward:

- **The Rodney script predates the 30 Sep–2 Oct guest UI and confirm-real-dates work.** The committed heading fix is not enough; it would next fail on the composer name ("Area, dates, guests"), "View apartment", the arrival-date question, the review-after-phone order, the back-office copy and the removed projection status strings. The drift list is in `wave-4-acceptance.md`. Refreshing the script is product/test work outside Wave 4. The browser record above is the 08c AC5 evidence.
- **Generate-after-build churn.** `pilot:local` and the Cloudflare static-assets test rewrite tracked `apps/local-guest/dist/*.js` and `apps/cloudflare/public/_headers` with LF endings. Restore them with `git restore` before any clean-tree gate; never commit that churn.
- **Do not start Wave 5 (10b+) without a request.** The integration branch merges to `main` only after slice 15; no push, deployment or staging claim.
- **Worktree cleanup pitfall: unlink `node_modules` before `git worktree remove`.** Slice worktrees use a `node_modules` junction into this checkout. At wave close, `git worktree remove` on `-08c` and `-09c-integration` followed the junction and emptied the shared `node_modules`. It was restored with `npm ci` (with `NODE_ENV` unset); `npm run check` and the 27 workerd tests passed afterwards.
  - To remove a junctioned worktree safely, delete the link itself first with `cmd /c rmdir <worktree>\node_modules`. That removes only the junction. Then run `git worktree remove`.
  - `-08a`, `-08b` and `-09a` were removed this way afterwards. Each held only untracked test scratch (`.scratch/eval-test`, `.scratch/local-guest`, `.scratch/local-owner`) and, in 09a, the generated `apps/cloudflare/public/` bundles. Those were cleared first so `git worktree remove` ran without `--force`. The shared install was unaffected, and the slice branches remain.

## Context pointers

- 09c: `75ccc2d`; Fetch-to-node-HTTP shim (`toHttpRequestLike` raw-byte pump, `createHttpResponseLike` collecting writeHead/setHeader/end with per-value `Set-Cookie` appends and destroy/throw→500, `clientAddressFromCloudflare` fail-closed to `"unknown"`); the implementation is `packages/platform-core/src/http-fetch-shim.ts` (Node-program-testable) with `apps/cloudflare/src/http-shim.ts` re-exported as the DO import site; workerd spec is shim-only because app node sources can't typecheck in the `apps/cloudflare` ambient — the real guest-handler multipart run via the shim is `test/http-shim-multipart.test.ts`. Probe noted: `node:sqlite` imports in workerd but `DatabaseSync` is illegal; a fully injected guest environment serves the multipart flow inside a DO (10b's composition route).
- 09b: `c9237eb`; `build-client.mjs` also writes the four bundles + byte-identical foundations CSS into gitignored `apps/cloudflare/public/` with a committed `_headers` mirroring the real route values (scripts: content-type only, no Cache-Control; CSS: `public, max-age=3600`); `?raw` CSS import prepared in `apps/cloudflare/src`; the real `cf build` proof is 10b's gate. Hash/byte tests included.
- 09a: `eb2a228`; `AssetLoader` (closed five-name union) + caching `nodeAssetLoader()` in `packages/platform-core`, both handlers default to it, every module-level `readFileSync` and per-request script read removed, import-time read proven absent by a subprocess probe on an empty cwd; missing assets answer per request (CSS/client.js 500, gallery/payment/offer 404). Decision for 09b/10b recorded in the issue: bundles+CSS as Static Assets before the Durable Object; CSS text inside the DO via a Vite `?raw` import (fallback: generated TS module), to be proven by a real `cf build` in 09b.
- 08c: `6c89dbc`; `createPilotRequestHandler` (health on the one shared handle, the four rate limiters, staging banner applied to the handler's own HTML response, `/operator*` dispatch, injectable clientAddress + `ready`), `proxyRequest` deleted from both pilot servers — no `127.0.0.1` literal stays in `apps/pilot/src` (grep test permanent; the bind address moved to `packages/platform-core/src/loopback-address.ts`). pilot-local, the browser phase and the pilot acceptance journey passed at wave close (see "Wave 4 completion").
- 08b: `bb247a3` extracts the owner request handler (`createOwnerRequestHandler`, thin `startLocalOwnerServer` wrapper); `readForm` converted to `on("data")` within the same 4 KiB ceiling; `HttpResponseLike.setHeader` accepts value lists so login/logout keep two separate `Set-Cookie` lines and the fake records them separately. Phase 1: 1,371 tests, zero failures; 22 workerd tests; `npm run check` clean.
- 08a: `f1ff86c` extracts the guest request handler behind `HttpRequestLike`/`HttpResponseLike` (`packages/platform-core/src/http-like.ts`); `createGuestRequestHandler` carries all request logic, `startLocalGuestServer` is a thin wrapper, and `test/helpers/http-like.ts` provides fake request/response builders for 08b/08c/09b/09c. Phase 1: 1,368 tests, zero failures; 22 workerd tests (hung-run false alarm did not reproduce); `npm run check` clean. Browser phase deferred to wave close.
- 07a/07b: `772d8a2`; blob port, SQLite and R2 stores, idempotent receipt-table migration (also on Durable Object SQL), put-then-commit with re-check, bounded body, no public/signed URL guard. 22 workerd tests; full suite evidence `C:/AI2026/cf-wave3-full.log`.
- 06d: `ca19100`; field-by-field audit in the issue's Comments, `SqliteOperatorEnforcementStateStore`, owner `production` flag, `test/operator-process-restart.test.ts`.
- 04a/04b/04c: `fb7e199`; injectable roots, `openNode` factories, shared handle for session runtimes, `sessionRuntimeLimit`.
- 02e: `602a11e`; repo-wide `node:sqlite` guard and the Guest Account authority on `SqlDatabase`.

- 10a: `a3fdb15`; shared explicit-source configuration core, unchanged Node validation, typed Cloudflare vars/bindings and lazily rechecked SQLite provisioning. Full suite and 16 workerd tests pass. See its Answer for scope and compiler/runtime evidence.

- 06c: implementation `502fcc1`; shared-handle revenue accounting and compatibility-manager state, atomic trigger-failure rollback, >2^31 integer-kobo round-trip, real owner restart and both existing release suites through the shared contract. Full evidence `C:/AI2026/cf-06c-full.log` (exit 0). No changes to current ADR 0089 owner-payable rules or to existing historical arithmetic.
- 06b: implementation `cee7988`; shared-handle redacted telemetry, durable unique hashed transition dedupe, restart/table/sink checks. Full evidence `C:/AI2026/cf-06b-full.log` (exit 0). The optional sink is observational, not commit-aware/outbox-backed; see its answer before 10b wiring.
- 06a: implementation `5303c68`; typed append-only shared-handle audit, environment restart/order and outer/nested rollback checks; raw table credential absence verified. Full evidence `C:/AI2026/cf-06a-full.log` (exit 0).

- 01b: spike `711b863` on throwaway `infra/cf-01b-runtime`; only answer `0b8d00c` integrated. See `spikes/runtime/README.md` on that branch for runnable snippets and observed outputs. No spike code merged.
- 02c: `7d8bb85` / `fe8c288` now passes its formerly pending full-suite gate; shared ownership, overlap and single-live-attempt checks are green. Issue resolved.
- 02d: implementation `491c399`, merged `d142a37`, delivery record `36c522c`. Shared operator handles, restart/expiry/revocation and atomic grant rollback; all label-only store path fields/arguments removed. Recovered misplaced worktree is no longer under the main `.scratch`.
- 03b: implementation `f80e537`, dedicated rollback check `e2fc91d`, delivery record `8161810`. Node/workerd share the unchanged eight-case SQL contract. Known PRAGMA no-ops, trigger-aware changes(), BLOB normalization, binding/value preflight and synchronous nested transactions verified. Unsafe bigint bindings fail rather than lose precision.
- 05b: implementation `d1d6687`, null-update parity `068a013`, delivery record `3eb69df`. Shared JSON/SQLite behaviour checks, CSV/bootstrap parity, lazy discovery expiry and file restart pass. No app wiring yet.

- 02b: `ca9de39` converts the seven shared-handle stores, adds non-owning Node wrapping and preserves savepoint boundaries inside existing raw Node transactions. Dedicated import/rollback/ownership tests and full suite pass. Existing app handles/foreign-key settings remain unchanged until 02e. Its inventory now explicitly covers Guest Accounts, sessions, codes, quota events and email-command receipts. Parent Chrome smoke on synthetic `http://127.0.0.1:3047/` exercised concierge turns and contact persistence across reload; only favicon 404 observed. Details in issue 02b.

- 03a: `492982a` adds the isolated workerd harness, exact Workers-plugin/Vitest/types pins and separate Node, Worker-source, Worker-test and tooling checks. SQLite `SELECT 1` passes in workerd; a Node-only SQLite import fails the source check. Full Node suite passed (1,265 non-browser / 165 browser, zero failures, one expected skip). See the issue answer for legacy pool-name correction, negative probe and `PI_REASONING_LEVEL` test-environment caveat. No production config or deployment introduced.

- 01a: `infra/cf-01a-do-sql-spike` holds the runnable SQL spike; its issue answer records SQL, PRAGMA, transaction, BLOB, row-count and limit evidence without merging the spike into the integration branch.
- 01c: Pinned `cf@1.0.0-beta.12`, `@cloudflare/vite-plugin@2.0.0-beta.sha-52b0dc0e9`, and Vite `8.3.2`; typed Worker proof covered SQLite DO, R2, assets, synthetic local secret, mode selection, generated types, dry-run deploys and the Workers Vitest harness. Details are in `issues/01c-cf-toolchain-foundation.md`. Full serial `npm test` (Phase 1 1,245 passed; Phase 2 165 passed, 0 failed, 1 skipped) and `npm run check` passed cleanly on 5 October 2026. Integrated toolchain by `9bf7b12`, Node minimum by `aa47f50`, secret ignores by `cc261c8`, and baseline reconciliation by `b547628`.
- 02a: Added synchronous SQL port, Node adapter and shared contract at `packages/platform-core/src/sql-database.ts`, `packages/platform-core/src/node-sqlite-database.ts` and `test/helpers/sql-database-contract.ts`; focused contract checks pass and full `npm test` passed on 5 October 2026.
- 05a: Added `UnitRepositoryContract` and JSON input validation in `domains/shortlet/src/browse.ts`; contract tests pass and full `npm test` passed on 5 October 2026.
- 14: Accepted hosting ADR 0095 and Cloudflare/Gemini privacy launch gates in `docs/adr/0095-host-the-pilot-on-cloudflare.md` and ADR 0065; counsel, contracts and retention evidence remain prerequisites for real-data issue 15. Renumbered from 0092 during integration to preserve the accepted Extended Stays decision; see `issues/14-adr-0095-and-dpia-update.md`.
- Main-refresh inventory: Guest Accounts add a direct Node SQLite authority; its SQL-port conversion is a prerequisite of 02e's repo-wide import guard. See the dated comment in `issues/02e-convert-app-layer-and-guard.md` before selecting the persistence wave.
- Main refresh verified: merged `main` at `f77c99d` (Guest Account authority, authenticated email-command idempotency and cross-tab recovery regression). Reconciled `guest-must-fix-ux.test.ts` with latest-request selection while retaining the production `disclosed` assertion and fixture-relative arrival; retained the inspection-safe onboarding clock (ADRs 0009/0056/0041/0042). Full serial `npm test` passed **1,262 non-browser tests and 165 browser tests, zero failures, one expected foundation-browser skip**; `npm run check` and staged whitespace checks passed. ADRs 0092/0093/0094 coexist with hosting ADR 0095, with no stale hosting references or conflict markers. Wave 1 remains closed; the new direct SQLite account authority is recorded for 02e, and the hosting decision's external gates remain open. Suite log: `sh_10c33f869001fK4nWjl5ElFzmn.out`.
