# Convert booking-funnel actions to ActionSpec

Status: ready-for-agent
Type: task
Blocked by: 07
Requested: 14 Oct 2026
Unlocks: 09a
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

Continue removing the duplicated gate (PRD, Diagnosis 3).

## What to build

Convert to `ActionSpec` on the platform gate from slice 07, keeping exported event names and result types:
`apps/web/src/booking-request-actions.ts`, `conditional-offer-actions.ts`, `booking-amendment-actions.ts`, `cancellation-actions.ts`, `payment-capability-actions.ts`. Remove the duplicated stale check from `cancellation-application.ts` if it is the same gate.

## Out of scope

- Stay-support actions (08b). Behaviour changes.

## Acceptance criteria

- AC1: Each of the five files contains no gate logic and declares only its spec and domain call.
- AC2: All existing tests for these flows pass unchanged.
- AC3: `contextOf` copies in these files are gone.

## Tests

Existing flow tests; add one gate test per converted spec for its stale path.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0060-require-versioned-booking-amendments.md` | Amendment versions are part of the stale rule. |
| `docs/adr/0058-adopt-a-standardized-cancellation-catalogue.md` | Cancellation semantics unchanged. |
| `docs/adr/0072-route-consequential-actions-through-platform-commands.md` | Commands still created by the gate. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
