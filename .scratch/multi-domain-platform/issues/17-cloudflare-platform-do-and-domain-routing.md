# Cloudflare platform Durable Object (accounts, conversations) and Worker routing by domain

Status: claimed
Type: task
Blocked by: 05, 13, 16
Requested: 14 Oct 2026
Unlocks: 24
Lane: C: Platform services
PRD: `../PRD.md`

## Why

Today `apps/cloudflare/src/worker.ts` routes everything to `ShortletPilot` (slice 05 decision).

## What to build

1. Add a platform DO class (SQLite) holding accounts, threads and tasks; the shortlet DO keeps shortlet transactions.
2. The Worker routes by path/domain; pack calls between DOs go through a small typed client.
3. Migration for existing pilot data per slice 05; extend `apps/cloudflare` Workers Vitest.

## Out of scope

- Commerce DO (24).

## Acceptance criteria

- AC1: Accounts and conversations are served from the platform DO.
- AC2: Shortlet flows pass the Workers test suite unchanged.
- AC3: Existing pilot data migrates (tested with an exported fixture).

## Tests

`apps/cloudflare/test` Workers Vitest additions.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0095-host-the-pilot-on-cloudflare.md` | Hosting, as amended by slice 05. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments

### Slice 17 implementation ADR mapping

| ADR | Constraint | Acceptance criterion / code path |
| --- | --- | --- |
| 0101 | PLATFORM owns accounts, threads and tasks; SHORTLET owns transactions and assurance; export/restore spans both DOs. | AC1 split schemas and DO ownership; AC2 path routing; AC3 two-DO export/import/cutover. |
| 0095 | Tenant-scoped SQLite DOs; no network I/O in synchronous SQLite transactions; `locationHint: "afr"` remains best-effort. | AC1 independent migration authority; AC2 same tenant key and location hint; AC3 per-DO cutover. |
| 0093 | Preserve account/code/session rules, fail-closed identity resolution and scoped claims after moving account authority. | AC1 account tables in PLATFORM; AC2 account routes; claim regression and typed cross-DO lookup. |
| 0094 | Assurance remains in SHORTLET, expires lazily and is invalidated on verified-email change. | AC1 assurance FK/trigger removal; cross-DO invalidation behavior regression. |
| 0096 | Exclude bearer credentials from export; preserve only its specific private daily-export payment-reference exception. | AC3 import/export exclusions per DO. |
| 0075 | No credentials or restricted identity material in audit, logs or interaction state. | AC3 exclusion checks and cross-DO failure-path audit/log behavior. |

## Answer

Independent review accepted AC3; AC1 and AC2 remain accepted. The issue stays **claimed**, not resolved, until the full `npm test`
and guest UI walkthrough/capture gates have run and passed.

| ADR | Constraint confirmed | Acceptance evidence |
| --- | --- | --- |
| 0101 | PLATFORM owns accounts/conversations; SHORTLET owns domain transactions and assurance; migration and cutover span both. | AC1 split-authority tests; AC3 authenticated two-DO legacy round trip, combined verify, per-kind cutover and status. |
| 0095 | Tenant-scoped SQLite Durable Objects; the Worker routes and synchronous storage remains authoritative. | AC1/AC2 routing and runtime tests; AC3 migration through both tenant-scoped authorities. |
| 0093 | Account identity, sign-in, credentials and linking retain their existing rules. | AC1 account-runtime and account-linking coverage; AC3 credentials excluded and sign-in required after rebuild. |
| 0094 | Assurance stays SHORTLET-owned and bound to the current account email revision. | AC3 legacy assurance lacking a trustworthy `account_email_revision` is omitted for fresh verification; current-shape assurance restore coverage remains. |
| 0096 | Its exception applies only to the specified payment-reference columns in the private daily export. | AC3 import/export exclusion coverage preserves the existing bounded export behavior. |
| 0075 | Credentials and restricted identity material do not enter logs or audit records. | AC3 credential exclusion/refusal assertions and assurance refusal checks. |

**Validation evidence:** `npx vitest run --config apps/cloudflare/vitest.config.ts --reporter=dot` passed **20 files / 100 tests**.
The six-file OPS/migration/restore/export selection passed **50 tests** with shuffled seeds `1701` and `48027`.
`npm run check` and `git diff --check` passed. The full `npm test` and guest UI walkthrough/capture gates have not run in
this validation; they remain required before resolving.

### Independent review record

- AC1 and AC2 remain accepted.
- AC3 accepted after the reviewer-requested test-tenant isolation and runbook corrections.
- Review acceptance does not change the issue state: keep `Status: claimed` until all Definition of Done gates pass.
