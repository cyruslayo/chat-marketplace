# Cloudflare platform Durable Object (accounts, conversations) and Worker routing by domain

Status: resolved
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

Independent reviewers accepted AC1, AC2 and AC3, including the final regression guard and all changes in the exact
candidate tree below. The locally approved fast-forward follows this resolution commit.

| ADR | Constraint confirmed | Acceptance evidence |
| --- | --- | --- |
| 0101 | PLATFORM owns accounts/conversations; SHORTLET owns domain transactions and assurance; migration and cutover span both. | AC1 split-authority tests; AC3 authenticated two-DO legacy round trip, combined verify, per-kind cutover and status. |
| 0095 | Tenant-scoped SQLite Durable Objects; the Worker routes and synchronous storage remains authoritative. | AC1/AC2 routing and runtime tests; AC3 migration through both tenant-scoped authorities. |
| 0093 | Account identity, sign-in, credentials and linking retain their existing rules. | AC1 account-runtime and account-linking coverage; AC3 credentials excluded and sign-in required after rebuild. |
| 0094 | Assurance stays SHORTLET-owned and bound to the current account email revision. | AC3 legacy assurance lacking a trustworthy `account_email_revision` is omitted for fresh verification; current-shape assurance restore coverage remains. |
| 0096 | Its exception applies only to the specified payment-reference columns in the private daily export. | AC3 import/export exclusion coverage preserves the existing bounded export behavior. |
| 0075 | Credentials and restricted identity material do not enter logs or audit records. | AC3 credential exclusion/refusal assertions and assurance refusal checks. |

**Final candidate and integration:** implementation commit `2e6e097`, reviewed regression fix `2068976`, final candidate
commit `10d7df8`, and accepted Weaver 0.3 integration merge `7511d9d15d301726e07e7893e5cfa222ff000726`
(tree `e792852b866678b6cb6b4aa3dc02253ea6ed354c`). The exact merge tree was independently accepted for AC1/AC2/AC3
and the final regression guard. The merge had no conflicts. At the time of this issue-resolution commit, canonical `main`
is `a1014e7`; the approved local fast-forward is the next integration step.

**Final validation on the exact merge tree:**

- `npm ci` and `npm run check` passed (both exit code 0).
- `npm run test:workers` passed **20 files / 100 tests** (separate validation).
- Targeted catalogue, Node export and platform-account tests passed **28/28**.
- `NODE_ENV=test npm test` passed with exit code 0. Phase 1 ran 245 files and passed **1,816/1,816** tests. Phase 2 ran
  32 browser files: **177 passed, 0 failed, 2 skipped** (179 counted; two opt-in standalone Chromium checks skipped).
- Guest UI capture evidence: **32 captures**, eight stages at widths 320, 390, 768 and 1280. No horizontal overflow was
  reported. The only 1x1 target reports are hidden native radio inputs; their visible labels are the interaction targets.
- `git diff --check` passed for the candidate diff and merge. The runbook's two six-credential lists already include
  `guest_account_email_commands`; no duplicate edit was needed.

**Definition of Done self-check:**

| DoD item | Evidence / result |
| --- | --- |
| 1. Each acceptance criterion has a dedicated named test. | AC1/AC2/AC3 acceptance and the exact merged tree were independently reviewed; named Worker tests cover account routing/ownership, unchanged Shortlet flows and legacy export/import migration. |
| 2. Named failure paths are exercised. | Worker/runtime, migration, assurance, export/import and account-linking tests include authorization, invalid legacy assurance, excluded credentials, routing and refusal paths; independent review accepted all criteria. |
| 3. Relevant ADRs are listed and constraints recorded. | ADRs 0101, 0095, 0093, 0094, 0096 and 0075 are mapped above and in the implementation comments. |
| 4. Injected dependencies are used. | Type-check and Worker tests passed on the final merge tree; independent review accepted the exact candidate. |
| 5. No invented policies or unresolved domain gaps. | Ownership, credential exclusions, email-revision handling and cutover behavior follow the mapped ADRs and runbooks. |
| 6. No bearer credentials or restricted identity material in logs/audit. | Credential exclusion/refusal tests and assurance refusal tests passed in the Worker suite and full test suite. |
| 7. Check and full test suite pass. | `npm run check` and `NODE_ENV=test npm test` passed with zero failures; Workers and targeted gates also passed. |

### Independent review record

- AC1 and AC2 remain accepted.
- AC3 accepted after the reviewer-requested test-tenant isolation and runbook corrections.
- At that interim review point, the full-suite and guest UI gates were still pending; this historical status note is superseded by the final approval and resolution above.

### Final resolution

- Final independent review accepted the exact merge commit `7511d9d15d301726e07e7893e5cfa222ff000726`, tree
  `e792852b866678b6cb6b4aa3dc02253ea6ed354c`, for AC1/AC2/AC3 and the final regression guard.
- The full-suite phase counts are recorded above; the separate Workers result is not added to Phase 1 because those tests
  are included in Phase 1.
- DoD self-check is complete. No push or deployment is part of this resolution.
