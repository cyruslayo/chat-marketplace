# Criteria strip: Where, When and Guests chips with undo

Status: ready-for-agent
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
