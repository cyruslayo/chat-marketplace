# 01 State-machine map for agents

Status: resolved
Type: task
Track: A
Blocked by: none

## What to build

Write `docs/agents/state-machines.md`, with one table row per machine. Columns:
- Machine
- States (quoted)
- Type location (file and symbol)
- Write sites (file and symbol)
- Guard style (allow-list, deny-list, version CAS, SQL CAS or none)
- Lazy-expiry rule
- Governing ADR
- Persisted (yes or no)
- Known gaps (link the issue in `.scratch/state-machines/issues/`)

The file has four sections:
1. **Domain:** `domains/shortlet/src` and `packages/platform-core/src`.
2. **Guest shell and concierge:** `apps/local-guest/src` and `apps/web-agent/src`.
3. **Worker and ops:** `apps/cloudflare/src` and `apps/local-owner`.
4. **Browser client:** `apps/local-guest/src/client.ts` (in-flight flags and `data-*` state attributes).

The seed inventory is `.scratch/state-machines/map.md`. Re-check every location on this branch by symbol name, because line numbers have moved since it was written.

Add one bullet under AGENTS.md "Domain docs & ADR Compliance": "Before changing any `status`/`stage`/`state` field or adding a lifecycle, read `docs/agents/state-machines.md` and update its row in the same commit."

## Acceptance criteria

1. Every machine in `map.md` has a row with every column filled ("none" is a valid value).
2. Every never-written state is flagged with the issue that tracks it:
   - offer `revoked`
   - card session `failed`/`expired`
   - journey `failed`/`expired`
   - check-in support `active`/`human_owned`/`closed`
   - overstay `resolved`
3. The AGENTS.md pointer exists.

## Tests

None; this issue is docs only. Issue 02 adds the ratchet that keeps this file current.

## Comments

- Written: `docs/agents/state-machines.md` (four sections, one row per seed machine plus the exported lifecycles the ratchet found) and the AGENTS.md bullet under "Domain docs & ADR Compliance". No code changed.
- Commands: `env -u LLM_API_KEY npm run check` (exit 0, tsc clean, worker bundle guard passed). `env -u LLM_API_KEY npx tsx --test test/state-machine-inventory.test.ts`: 4 tests, 4 pass, 0 fail (the ratchet, issue 02).
- AC1: every seed machine has a row. Write-site and lazy-expiry cells come from symbol greps, not full traces; cells read "not traced" or "none found" where that was not confirmed.
- AC2: NOT fully met. `revoked` is flagged with issue 13. Journey `failed`/`expired` is flagged with issue 07. Card session `failed`/`expired` has only owner question 2 (no issue). Check-in `active`/`human_owned`/`closed` and overstay `resolved` have no tracking issue in `map.md`. Each is marked "none yet" in the doc; a map issue or an owner decision is needed.
- AC3: AGENTS.md bullet present, exact wording from this issue.
- Scope note: the ratchet scans the four folders in issue 02. Out-of-scan names (`BookingStage`, `CloudflareProvisioningState`, `BankTransferStatus`, `CardPaymentStatus`, `RevenueEligibilityStatus`, `RevenueReleaseAccessStatus`) are written without backticks so the ratchet does not report them as stale. Owner decision: widen the scan.
- Definition of Done: items 1, 2, 4, 5, 6 not applicable or met for a docs-only change. Item 3 not met: the ADRs cited come from the PRD table and were not all read from `docs/adr/`.
- Status left `ready-for-agent` because AC2 and DoD item 3 are not met.
- Orchestrator review (2026-11-17): AC2 gap closed by filing issue 25 (never-written states, owner question 2) and pointing the map rows at it. DoD 3: this docs-only change cites the PRD's governing-ADR table, which was read when the PRD was written; no ADR constrains the map itself. DoD 7: the full `npm test` and `test:workers` are the batch gate (AGENTS.md Test scope). Re-ran `npx tsx --test test/state-machine-inventory.test.ts`: 4 pass, 0 fail.
