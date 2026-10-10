# Validate and pin the `cf` Workers toolchain

Status: resolved
Type: prototype
Blocked by: 01a
Branch: `infra/cf-01c-toolchain`
Requested: 3 Oct 2026
Unlocks: 01b, 03a

## Why

The deployment effort should use Cloudflare's `cf` CLI and typed `cloudflare.config.ts` as its primary Workers workflow. `cf` is in beta; verify this repository's Durable Object SQL, R2, static assets, local development and test needs before later slices depend on it.

## What to build

- Pin a project-local `cf` version and compatible Vite/plugin versions selected by the spike. `cloudflare.config.ts` requires Node 22.18 or later; raise the root `engines.node` minimum from 22.13 to at least 22.18.
- In a throwaway directory outside the root TypeScript include, exercise `cf init`, `cf dev`, `cf build`, and `cf deploy --dry-run` on a minimal Worker using `cloudflare.config.ts`.
- Verify a SQLite-backed Durable Object export and binding, local R2 binding, static assets, `nodejs_compat`, generated `cf workers types`, and staging/production mode selection.
- Confirm the selected local test harness works with this configuration. `@cloudflare/vitest-pool-workers` may use Wrangler internally; document that as a test-runtime dependency if required, not as the project-development or deployment CLI.
- Confirm required unsupported `cf` operations and their exact documented fallback. The beta may lack standalone secret setting and live log streaming. Do not invent `cf` subcommands.
- Record exact versions, commands, configuration shape, findings, remaining beta limitations and fallback in `## Answer`.

## Out of scope

- Production app configuration, real Cloudflare resource creation or deployment.
- Migrating app code or creating the production Durable Object.

## Acceptance criteria

- AC1: The minimal Worker starts with `cf dev` and exercises Durable Object SQLite, local R2 and static assets.
- AC2: `cf build`, `cf deploy --dry-run`, `cf workers types`, and staging/production mode selection succeed with the pinned toolchain.
- AC3: The chosen Workers test harness runs a minimal Durable Object test; any Wrangler dependency is identified as an implementation detail rather than a developer-facing CLI.
- AC4: `## Answer` records tested versions, commands, results, and beta gaps/fallbacks; `npm run check` and `npm test` remain green.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0004 | Durable Object remains authoritative; do not place app state in CLI/config | Minimal Worker and Durable Object proof |
| 0065 | Hosting/vendor and cross-border implications remain launch gates | Record beta/deployment assumptions without treating tool choice as DPIA approval |
| 0075 | Secrets and restricted data never enter logs | Local secret handling and command output review |
| 0080 | Critical routes retain deterministic parity | Toolchain validation must not require agent-only behavior |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Answer

### Versions and configuration

- Verified with Node `22.19.0` and npm `10.9.3`; `cloudflare.config.ts` requires Node 22.18 or later.
- Pinned the project-local tools exactly: `cf@1.0.0-beta.12`, `@cloudflare/vite-plugin@2.0.0-beta.sha-52b0dc0e9`, and `vite@8.3.2`. `npm ls cf @cloudflare/vite-plugin vite --depth=0` reported those exact versions.
- `npm exec cf -- init workers C:\Users\Cyrus\AppData\Local\Temp\opencode\cf-toolchain-01c-20261004 --no-install --quiet` created a project with typed `cloudflare.config.ts`, `vite.config.ts`, and npm scripts. `cf init`'s generated package uses version ranges, so the project root was pinned explicitly.
- The probe's typed config used `defineConfig`, `defineWorker`, `exports.durableObject({ storage: "sqlite" })`, a Durable Object binding, `bindings.r2`, `bindings.assets`, `compatibilityFlags: ["nodejs_compat"]`, and `assets.runWorkerFirst`. A context-aware config factory selected worker names by `mode`. The Worker exposed synthetic `/sql`, `/r2`, `/secret`, `/mode` and static `/` routes.

### Commands and observed results

- `npm exec cf -- workers types` succeeded and generated `.cloudflare/types/index.d.ts`.
- `npm exec cf -- build`, `npm exec cf -- build --mode staging`, and `npm exec cf -- build --mode production` all succeeded.
- `npm exec cf -- deploy --dry-run --mode staging` and `npm exec cf -- deploy --dry-run --mode production` both completed without upload. Their reports showed the SQLite-backed Durable Object, R2 bucket, and Assets bindings; worker names differed (`cf-toolchain-proof-staging` and `cf-toolchain-proof-production`). No real resource was created or deployed.
- `npm exec cf -- dev` started the Vite/Workers runtime. Requests returned: `/` → HTML containing `static-asset-ok`; `/sql` → `{"value":"sqlite-ok"}`; `/r2` → `r2-ok`; `/secret` → `secret-bound` using a synthetic, temporary `.dev.vars` value. The development Worker exercised SQLite-backed DO storage, local R2 put/get, and static assets.
- Added root ignore rules for `.cloudflare/`, `.wrangler/`, `.dev.vars*` (while permitting `.dev.vars.example`) so generated tool state and local secret files stay out of commits.
- `npm exec cf -- dev --port 5174` failed because this beta cannot forward arguments to the detected Vite dev command. Setting `server.port` in `vite.config.ts` worked; the successful proof used port 5181.
- The local Workers test proof used `vitest@4.1.11` and `@cloudflare/vitest-plugin@1.3.6`. A Vitest integration test invoked the SQLite-backed Durable Object and passed (1 test). Its test-only `wrangler.test.jsonc` described the same DO/R2/assets runtime; the plugin depends on `wrangler@4.147.0` internally. Wrangler is therefore a transitive test-runtime dependency only, not the project's build, dev or deploy CLI.
- `npm exec cf -- workers secrets update --help` and `npm exec cf -- workers secrets bulk --help` expose secret management; `npm exec cf -- deploy --help` also documents `--secrets-file`. No CLI authentication or secret upload was attempted. `npm exec cf -- tail --help` returned the generic unknown-command help and the command listing contains no `tail`; the exact supported live-log fallback is Cloudflare Dashboard → Workers & Pages → select the Worker → Observability. `npm exec cf -- logs retrieve get --help` describes retrieval of logs already stored in R2, not live streaming.
- `npm run check` passed. On 5 October 2026, a full serial `npm test` run succeeded with zero failures: Phase 1 passed all 1,245 concurrent tests and Phase 2 passed all 165 real-browser tests (1 skipped per design). The earlier intermittent focus failure in `AC1: In real Chromium, starting a new conversation keeps the Booking Request and says so, at 375px and 1280px` was reconciled by deferring focus via `requestAnimationFrame` after layout and awaiting focus after the asynchronous committed-work lookup (ADR 0078). All acceptance criteria AC1–AC4 and Definition of Done checks are satisfied.

### ADR mapping

| ADR | Constraint | Result |
| --- | --- | --- |
| 0004 | Durable Object remains authoritative; configuration must not own application state | Probe state exists only in the SQLite-backed DO; the Worker only routes requests and serves assets. |
| 0065 | Hosting/vendor and cross-border implications remain launch gates | This proves tooling only; it does not close any privacy or vendor gate. |
| 0075 | Secrets and restricted data never enter logs | Local secret was synthetic, temporary and tested through a boolean response; no secret value was logged or committed. |
| 0080 | Critical routes retain deterministic parity | This toolchain proof is independent of guest/operator workflows and adds no agent-only behavior. |
