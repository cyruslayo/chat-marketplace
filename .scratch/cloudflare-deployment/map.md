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
| 01c | Validate and pin the `cf` Workers toolchain | prototype | claimed | 01a | 01b, 03a |
| 01b | Spike Workers runtime compatibility | prototype | ready-for-agent | 01a, 01c | 09c, 10b |
| 02a | `SqlDatabase` port, Node adapter, contract helper | task | claimed (focused checks green; baseline suite gate open) | none | 02b–02d, 03b, 05b, 06a–06c |
| 02b | Move the seven handle-taking stores onto the port | task | ready-for-agent | 02a | 02e, 07a |
| 02c | Move the availability and guest-interaction stores onto the port | task | ready-for-agent | 02a | 02e |
| 02d | Move the operator grant and session stores onto the shared handle | task | ready-for-agent | 02a | 02e |
| 02e | Move the app layer onto the port; guard `node:sqlite` imports | task | ready-for-agent | 02b, 02c, 02d | 04a, 04b |
| **B: Workers harness** | | | | | |
| 03a | Workers test harness and `apps/cloudflare` skeleton | task | ready-for-agent | 01a, 01c | 03b, 07b, 09b, 09c |
| 03b | `DurableObjectSqlDatabase` passing the shared contract | task | ready-for-agent | 02a, 03a | 10b |
| **C: Composition and repositories** | | | | | |
| 04a | Injectable guest composition root | task | ready-for-agent | 02e | 04c, 08a |
| 04b | Injectable owner composition root | task | ready-for-agent | 02e | 06d, 08b |
| 04c | Session runtimes share one handle, with a size cap | task | ready-for-agent | 04a | 10b |
| 05a | Typed unit repository interface | task | claimed (AC4 baseline suite gate open) | none | 05b |
| 05b | SQLite unit and operator repositories | task | ready-for-agent | 02a, 05a | 10a |
| **D: Durable state** | | | | | |
| 06a | Durable, typed, redacted audit log | task | ready-for-agent | 02a | 06d |
| 06b | Durable, redacted telemetry | task | ready-for-agent | 02a | 06d |
| 06c | Durable revenue accounting and release state | task | ready-for-agent | 02a | 06d |
| 06d | Durable enforcement and booking state; operator restart test | task | ready-for-agent | 04b, 06a, 06b, 06c | 15 |
| 07a | `ReceiptBlobStore` port, SQLite implementation, migration | task | ready-for-agent | 02b | 07b |
| 07b | R2 receipt store | task | ready-for-agent | 03a, 07a | 10b, 12a |
| **E: HTTP** | | | | | |
| 08a | Narrow HTTP types; extract the guest request handler | task | ready-for-agent | 04a | 08b, 09c |
| 08b | Extract the owner request handler | task | ready-for-agent | 04b, 08a | 08c |
| 08c | In-process pilot handler; remove the localhost proxy | task | ready-for-agent | 08b | 09a, 10b |
| 09a | Injected asset loader | task | ready-for-agent | 08c | 09b |
| 09b | Build static assets for Cloudflare | task | ready-for-agent | 03a, 09a | 10b |
| 09c | Fetch-to-node-HTTP shim | task | ready-for-agent | 01b, 03a, 08a | 10b |
| **F: Cloudflare assembly** | | | | | |
| 10a | Cloudflare configuration loader | task | ready-for-agent | 05b | 10b |
| 10b | Worker, Durable Object and typed `cf` config, running on `cf dev` | task | ready-for-agent | 01b, 03b, 04c, 07b, 08c, 09b, 09c, 10a | 11a, 12a, 12b, 13 |
| 11a | `/_ops` authentication and operator routes | task | ready-for-agent | 10b | 11b |
| 11b | Inventory import route; CLIs over HTTPS | task | ready-for-agent | 11a | 15 |
| 12a | Daily export and orphan-receipt sweep alarm | task | ready-for-agent | 07b, 10b | 15 |
| 12b | Restore runbook | task | ready-for-agent | 10b | 15 |
| 13 | Observability and edge security | task | ready-for-agent (the dashboard steps need a human) | 10b | 15 |
| 14 | ADR 0092 and DPIA update | grilling | resolved (architecture accepted; external gates open) | none | 15 |
| **G: Release** | | | | | |
| 15 | Staging rehearsal; merge to `main` | task | ready-for-human | 06d, 11b, 12a, 12b, 13, 14 (cross-border, contracts and retention gate) | 16 |
| 16 | Data migration and cutover | task | ready-for-human | 15 | 17 |
| 17 | Retire the Node production entry | task | ready-for-agent | 16 | none |

**What can run at once.** Slices 01a, 02a, 05a and 14 have no blockers. After 01a lands, 01c can start; after 01c lands, 01b and 03a can proceed. After 02a lands, 02b, 02c, 02d, 06a, 06b and 06c can all run in parallel.

## Delivery waves (one wave per implementation session)

Waves are session-sized batches of slices, not replacements for the `Blocked by` graph. A session may implement only the unblocked slices listed for its wave; do not wait for unrelated slices in the same wave when their own dependencies are satisfied. Merge each completed slice into `infra/cloudflare-deployment` before starting a dependent slice. If a slice is still blocked, leave it for the next session rather than widening the batch.

| Wave | Session focus | Issues | Start when | Handoff / exit gate |
|---|---|---|---|---|
| **1 — Foundation** | Establish integration branch, validate Cloudflare SQL, pin and prove the `cf` toolchain, and land the common SQL port and repository seam. | 01a, 01c, 02a, 05a, 14 (human review can proceed in parallel) | Start with 01a, 02a and 05a; 01c follows 01a. Start human review for 14 early. | 01a establishes `infra/cloudflare-deployment`; 01c records pinned `cf` versions/commands and verified capabilities; 02a provides `SqlDatabase`; 05a provides the repository contract. ADR 0092/DPIA decision from 14 is recorded before release wave 6. |
| **2 — Parallel persistence and harness** | Convert existing stores and prove the Workers runtime/database adapter; establish SQLite repositories and durable audit/telemetry/revenue. | 01b, 02b–02d, 03a, 05b, 06a–06c | 01b and 03a after 01a/01c; 02b–02d and 06a–06c after 02a; 05b after 02a/05a. | `npm run check`, `npm test` and `npm run test:workers` pass; Node adapter contract remains green; runtime assumptions and test-harness/tooling limits are documented. |
| **3 — Composition and durable services** | Inject dependencies into guest/owner compositions, share the DB handle, complete restart-safe operator state, and move receipts to R2. | 02e, 04a–04c, 06d, 07a–07b, 10a | 02e after 02b–02d; 04a/04b after 02e; 04c after 04a; 06d after 04b/06a–06c; 07a after 02b then 07b after 03a; 10a after 05b. | Both environments consume injected dependencies; restart and repository contracts pass; receipt storage and Cloudflare configuration loader are ready for assembly. |
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

## Values to ask the user, not invent

- 02e: whether to fix owner fixture data or turn off `foreign_keys` for the owner database, if turning it on breaks an owner fixture.
- 04c: the default cap on in-memory session runtimes.
- 10a: how the Durable Object behaves on first boot before inventory is imported, for example a 503 "not provisioned".
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

## Context pointers

- 01a: `infra/cf-01a-do-sql-spike` holds the runnable SQL spike; its issue answer records SQL, PRAGMA, transaction, BLOB, row-count and limit evidence without merging the spike into the integration branch.
- 02a: Added the synchronous SQL port, Node adapter and shared contract at `packages/platform-core/src/sql-database.ts`, `packages/platform-core/src/node-sqlite-database.ts` and `test/helpers/sql-database-contract.ts`; focused tests/typecheck pass, while the existing full-suite baseline failures remain open.
- 05a: Added `UnitRepositoryContract` and JSON input validation in `domains/shortlet/src/browse.ts`; focused tests/typecheck pass, while AC4 remains open on baseline full-suite failures.
- 14: Accepted hosting ADR 0092 and Cloudflare/Gemini privacy launch gates in `docs/adr/0092-host-the-pilot-on-cloudflare.md` and ADR 0065; counsel, contracts and retention evidence remain prerequisites for real-data issue 15.
