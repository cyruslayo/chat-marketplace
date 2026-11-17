# PRD: make the implicit state machines explicit

Status: ready-for-agent
Type: task

## Problem

About 30 lifecycles in apartment booking are implicit. Each is a string union, or a set of nullable fields, written inline (`x.status = "..."`, `{ ...x, stage }`) and guarded by ad hoc checks, most often deny-lists. No transition table exists in the repo.

- **Guest (UX):** the guest sees contradictory states. The stage is derived 9 ways that disagree. Stale offers restore as active. An expired confirmation traps the guest. An unknown payment status renders "Booking confirmed".
- **Developer (DX):** status literals are repeated across about 35 files. Guards are copy-pasted, and `BookingRequest` is stored as `Map<string, any>`.
- **Agent (AX):** agents cannot find the legal transitions, so they re-derive them, wrongly. This is the class of staging defect that ADR 0106 records.

## Outcome

1. One map an agent reads first (`docs/agents/state-machines.md`), kept current by a ratchet test.
2. Exported state unions, plus allowed-from tables that encode current behaviour, plus one pure predicate (`canTransition`).
3. Small, tested fixes for the confirmed defects. Each names the single behaviour it changes.

## Tracks (never mixed in one issue)

- **A: Inventory.** Docs and a ratchet test. No runtime change.
- **B: Behaviour-preserving explicitness.** Characterisation tests come first, and the diff changes no behaviour.
- **C: Defect fixes.** One per issue, failing test first.
- **D: Research.** Write a repro test, or close the issue as not-a-bug. A confirmed finding becomes a new C issue.

## Rules

- **Persisted status strings are never renamed.** Stored rows and the daily export use them. Note glossary drift in the map.
- **No generic state-machine library.** Mirror the existing precedents:
  - `apps/local-guest/src/agent-mark-state.ts` (const array, then the union, then a pure `next()`).
  - `packages/platform-core/src/human-handoff.ts` `#transition`.
  - The allowed-from lists in `domains/shortlet/src/security-deposit-accounting.ts`.
  - The pure projection in `domains/shortlet/src/owner-payable.ts`.
- **`canTransition` never throws.** Callers keep their own error strings and idempotent returns, so no error text changes.
- **For exhaustive presentation, use `satisfies Record<Status, Copy>` maps** (precedent: `apps/local-guest/src/landing-photos.ts`).
- **Shell and assistant-runtime changes** follow ADR 0106. Tests run with the assistant enabled and a cold restore (a new `LocalGuestApp` over the same store) before every event. They use a fresh thread, the 2026-10-27 clock, and a guest with no seeded phone or email. Model: `test/assistant-cold-journey.test.ts`.
- **Out of scope:** commerce, and the test-only `DepositClaimManager` / `SecurityDepositManager`. Both are flagged in the map.
- **Line numbers in the issues are from `main` at bf49ffa.** Find code by symbol name first.

## Governing ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0004 | The backend owns authoritative state | Projections derive from domain state |
| 0041, 0043 | Disclosed request blocks inventory for 30 min; delivery pending lasts at most 5 min | BookingRequest |
| 0044, 0045, 0047, 0090 | Payment Window 20 + 10 grace min; a late payment is refunded; transfer expiry; manual transfer 60 min | Payment journey, transfer sessions |
| 0046 | One Live Payment Attempt; locked, idempotent session transition | Attempt and checkout sessions |
| 0060 | Amendments are atomic and versioned | Amendment guard |
| 0074 | Surface lifecycle is fail closed | `surface.ts`, offer restore status |
| 0075 | Audit and logs hold ids and transitions only | Every new diagnostic |
| 0076, 0107 | `human` is absorbing; agent mark | Already explicit; reference only |
| 0106 | Cold restore on every request; re-key ids, never re-mint | Every shell or runtime issue |

## Questions for the owner (agents do not decide these)

1. **Late decline.** When an operator declines after the response deadline, the code records `declined`; ADR 0041 suggests `expired`. Which should it be? (`booking-request.ts`, `decline`)
2. **States never written.** Offer `revoked`, card session `failed`/`expired`, and journey `failed`/`expired`. Keep each as a reserved state, or remove it from its union?
3. **Legacy managers.** Delete the test-only `DepositClaimManager` and `SecurityDepositManager`?
4. **Glossary alias.** Add a CONTEXT.md alias (`disclosed` = "Pending Operator") without renaming the stored string?
