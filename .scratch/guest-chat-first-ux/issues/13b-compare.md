# Two-up comparison from results

Status: resolved
Type: task
Blocked by: 11, 09
Parent: [13](13-thread-control.md)

## What to build

Let the guest pick two results and open a comparison of the All-In Stay Total, capacity and amenities, stacked vertically at narrow widths. Build it from Basic Catalog components in `discovery-a2ui.ts`.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC2: Choosing Compare on two results shows price, capacity and amenities aligned.
- AC3: At 320px, the comparison stacks attributes vertically with no horizontal scroll.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0078 | Comparison stacks vertically at narrow widths |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/13b-compare.md` (repo root). Each result card has a Compare button. `thread.compareSelection` is in memory and cleared by a new search. The comparison uses Basic Catalog rows in fixed order: All-In Stay Total, Refundable Security Deposit on its own row, capacity, then amenities. Tampered or unknown context fails with `INVALID_CONTEXT`.
  - Evidence: test/guest-compare.test.ts (AC2 and failure paths); test/guest-compare-chromium.test.ts (AC3 at 320px, 375px and 1280px). Code: apps/web-agent/src/discovery-a2ui.ts (`compareArtifactToA2UI`, `COMPARE_ATTRIBUTES`). Landing: PR #66, commit 1c3a2ad.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
