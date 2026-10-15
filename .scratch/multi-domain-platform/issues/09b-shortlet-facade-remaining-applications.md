# Shortlet façade, remaining applications; .manager. reach-throughs to zero

Status: resolved
Type: task
Blocked by: 09a, 08b
Requested: 14 Oct 2026
Unlocks: 10
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

Finish removing the pass-through layer (PRD, Diagnosis 2).

## What to build

Repeat slice 09a for every remaining `apps/web/src/*-application.ts` with `readonly manager`. Record the before/after `.manager.` count in `## Answer` and update the metric in `map.md`.

## Out of scope

- Shrinking `index.ts` exports (10).

## Acceptance criteria

- AC1: No class in `apps/web/src` exposes `readonly manager`.
- AC2: `grep -rn '\.manager\.' apps --include=*.ts` (non-test) returns zero.
- AC3: Existing tests pass unchanged.

## Tests

Existing tests; façade tests for newly public operations.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0004-web-and-backend-own-authoritative-state.md` | State authority unchanged. |
| `docs/adr/0003-build-an-extensible-concierge-platform.md` | Domain owns its rules. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Answer

Repeated slice 09a for every remaining application with an exposed manager:
- `booking-amendment-application.ts`, `booking-contract-application.ts`, `cancellation-application.ts`, `checkin-support-application.ts`, `checkout-overstay-application.ts`, `guest-conduct-application.ts`, `human-handoff-application.ts`, `revenue-release-application.ts`, `revenue-release-authority-adapters.ts` — manager moved to a private field; internal calls updated.
- New façades replace the two external reads: `CheckInSupportApplication.projectCheckInStatus` (used by `local-owner-environment`) and `CheckoutOverstayApplication.calculateCheckoutSchedule` (used by `checkout-overstay-artifact`).
- Where the manager sat inside the options bag (`#o.manager`), it is now a private `#manager` field.

Metric: apps non-test `.manager.` 45 → **0** (baseline 112).

Tests:
- `test/slice-09b-facade.test.ts` — AC1 "no class in apps/web/src exposes a readonly manager" (ignoring constructor-injection `*Options` interfaces) and AC2 "no `.manager.` reach-through remains in apps/ (non-test)". Both green.
- AC3 "Existing tests pass unchanged" — the affected flow tests pass (60 green in the batch; full suite below). No test needed a call-site change: the remaining `s.manager`/`other.manager` reads in tests are raw domain managers, not application managers.

Verification: `npm run check` clean. `npm run test:non-browser` phase 1: 1749 pass / 6 fail; 4 are the pre-existing failures (see slice 06) and 2 were `fetch failed` server-startup races in `guest-cross-tab-concurrency.test.ts`, which passes 18/18 in isolation.

## Comments

- 14 Oct 2026 (agent): Constructor-injection fields named `manager` on `*Options` interfaces stay (that is how the manager is supplied); only the exposed class property is gone. The AC1 scan ignores `interface` lines.
