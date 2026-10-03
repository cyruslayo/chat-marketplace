# Validate and pin the `cf` Workers toolchain

Status: ready-for-agent
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

(Record the tested toolchain and findings.)
