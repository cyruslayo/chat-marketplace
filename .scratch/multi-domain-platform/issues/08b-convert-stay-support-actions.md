# Convert stay-support actions to ActionSpec

Status: ready-for-agent
Type: task
Blocked by: 07
Requested: 14 Oct 2026
Unlocks: 09b
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

Finish removing the duplicated gate (PRD, Diagnosis 3).

## What to build

Convert to `ActionSpec`, keeping exported event names and result types:
`apps/web/src/checkin-support-actions.ts`, `checkout-overstay-actions.ts`, `mid-stay-failure-actions.ts`, `relocation-actions.ts`, `deposit-claim-actions.ts`, `guest-conduct-actions.ts`, `human-handoff-actions.ts`, `discovery-actions.ts`. Remove the duplicated stale checks from `checkout-overstay-application.ts`, `deposit-claim-application.ts`, `mid-stay-failure-application.ts`, `protection-fund-application.ts`, `protection-fund-relocation-adapter.ts`, `relocation-application.ts` where they are the same gate. If `discovery-actions.ts` does not fit `ActionSpec`, record why in `## Comments` and leave it.

## Out of scope

- Booking-funnel actions (08a).

## Acceptance criteria

- AC1: Each converted file contains no gate logic.
- AC2: All existing tests for these flows pass unchanged.
- AC3: No `STALE_ACTION` gate implementation remains outside `packages/platform-core` (except any documented discovery exception).

## Tests

Existing flow tests; one gate test per converted spec for its stale path.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0076-suspend-automation-during-human-takeover.md` | Handoff actions keep suspension semantics. |
| `docs/adr/0017-give-guests-forty-eight-hours-to-answer-deposit-claims.md` | Deposit claim deadlines unchanged. |
| `docs/adr/0028-let-guests-choose-relocation-or-refund.md` | Relocation choice unchanged. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
