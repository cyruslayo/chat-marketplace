# Criteria strip: Where, When and Guests chips with undo

Status: resolved
Type: task
Blocked by: 02, 10
Parent: [03](03-criteria-strip.md)

## What to build

Add the persistent strip above the composer with Where, When and Guests chips (budget comes in 03b). Editing a chip sends a criteria-edit event, which goes on `EVENT_STAGE_ALLOW_LIST` (`guest-server.ts:137`) and is handled in `#handleEvent` (:379), and the active results update. Keep a criteria history on the thread and in `guest-projection.ts` so "Undo last change" works after reload.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC1: The strip always shows the current server-side criteria after each turn.
- AC2: Editing a chip re-runs the search and replaces the results surface without a typed message.
- AC3: An edit that breaks policy (for example 15 nights) is rejected inline with the limit stated, and the previous value is kept.
- AC4: "Undo last change" restores the previous criteria and results.
- AC5: The strip can be operated by keyboard alone and reflows at 320px.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0004 | Criteria are server state; the client never searches on its own |
| 0073 / 0081 | Use Basic Catalog components first; custom ones need evidence the catalogue is insufficient |
| 0078 | 44px targets, 320px reflow, keyboard operable |
| 0080 | The same criteria are editable on the conventional search route |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 28 Sept 2026: the audit for launch-readiness issue 10 found this work implemented and tested on main, but this file was never set to resolved. The status is left for a human to confirm against the Definition of Done.
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/03a-criteria-strip.md` (repo root). Where, When and Guests criteria are projected on every response. `shortlet.criteria.edit` and `.undo` are fail-closed (`CRITERIA_LOCKED`, `STALE_SURFACE`, `INVALID_CRITERIA`); undo keeps up to 11 prior searches. Below 48rem the strip is a compact summary with an Edit search toggle (26 Sept review).
  - Evidence: test/guest-criteria-strip.test.ts; test/guest-criteria-strip-chromium.test.ts (AC5, keyboard only at 320px). Code: apps/local-guest/src/guest-server.ts (`#criteriaGuard`, `#handleCriteriaEdit`); apps/local-guest/src/concierge.ts (`applyCriteriaEdit`). Landing: PR #61, commits f347d9a, 0063055.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
