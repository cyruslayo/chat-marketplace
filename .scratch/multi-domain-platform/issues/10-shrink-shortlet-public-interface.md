# Shrink domains/shortlet/src/index.ts to the façade; empty the boundary allow-list

Status: resolved
Type: task
Blocked by: 09b, 06
Requested: 14 Oct 2026
Unlocks: 16
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

798 exports make the interface as large as the implementation (PRD, Diagnosis 1).

## What to build

1. Replace `export *` lines in `domains/shortlet/src/index.ts` with explicit exports of the façade(s), their public types, and what `apps/` genuinely needs (repository construction for hosts may stay via a single `createShortletPack(deps)`).
2. Remove every allow-list entry from slice 06 by routing imports through `index`.
3. Record the export count in `map.md`.

## Out of scope

- Moving payments or accounts out (15, 16).

## Acceptance criteria

- AC1: The slice-06 allow-list is empty and the boundary test passes.
- AC2: `domains/shortlet/src/index.ts` has no `export *` and fewer than 50 exported names (or the remaining count and reason are recorded).
- AC3: Existing tests pass unchanged.

## Tests

Boundary test from slice 06; existing tests.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0003-build-an-extensible-concierge-platform.md` | Domain pack boundary. |
| ADR from slice 01 | Module boundary rule. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Answer

Done and green:
- Every non-test deep import into `domains/shortlet/src/<x>` now routes through `domains/shortlet/src/index.ts` — 92 specifier rewrites across 40 files (`apps/cloudflare/src/*`, `apps/local-guest/src/*`, `apps/local-owner/src/*`, `apps/pilot/src/*`, `apps/web/src/*`, `scripts/export-node-sqlite.ts`).
- The slice-06 allow-list shrank from 91 pairs (41 modules / 39 files) to **3 pairs / 1 module**.
- `index.ts` gained the module it never re-exported (`manual-transfer-account`).

Accepted by the owner (14 Oct 2026):
- **AC1 exception:** the three remaining pairs all import `guest-identity-assurance` (`apps/cloudflare/src/ops-import.ts`, `apps/cloudflare/src/schema.ts`, `apps/local-guest/src/guest-identity-status.ts`). That module is deliberately not barrelled: `test/guest-identity-assurance.test.ts` AC5 walks the import graph "through barrels or direct imports" and requires only the schema manifest, the import validator, the check-in helper and the status reader to reach the assurance store, and nothing to reach the eligibility helper (ADR 0085). A barrel re-export would make it reachable from every `index` importer. The owner accepted this tiny explicit allow-list as the boundary rule's intent ("no accidental leakage") rather than weakening the security test.
- **AC2 deferral:** `index.ts` is still 72 `export *` lines / ~729 declarations. Reaching <50 means app code and its `*-artifact` presentation stop consuming domain internals and move into the pack; that lands with the pack-extraction slices (12–14).

Verification: `npm run check` clean. `npm run test:non-browser` phase 1: 1750 pass / 4 pre-existing failures (see slice 06).

## Comments

- 14 Oct 2026 (agent): Recorded `needs-info`, then the owner accepted the recommendation: keep the 3-pair allow-list for the security-guarded module and let AC2 ride with the pack-extraction slices.
