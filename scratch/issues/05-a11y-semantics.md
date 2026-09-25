# Accessibility semantics pass

Status: resolved
Type: task
Findings: F8 (see ../PRD.md)

## What to build

- Render every action as a real `<button>` with an accessible name, and remove the unnamed button.
- Give the transcript `role="log"` with polite announcements. Keep the assertive announcer for errors only.
- Make `#transcript` a working scroll container (today it is `overflow: visible`, `guest-server.ts:1490`).
- Close the focused workspace with Escape, and return focus to its opener.

## Acceptance criteria

- AC1: Request to Book, Review request, Submit, Accept and checkout actions have role=button with a name.
- AC2: No button lacks an accessible name.
- AC3: New assistant turns are announced politely; errors are announced assertively.
- AC4: Escape closes the focused workspace and moves focus back to the control that opened it.
- AC5: New turns scroll into view inside the transcript at 320px and 1280px.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0078 | Accessible Nigerian launch profile |
| 0074 | Fallback surfaces stay announced |
| 0081 | Weaver remains a presentation runtime; safe fallback and conventional-route parity remain available |
| 0080 | Material and recovery-critical actions keep deterministic conventional parity |
| 0075 | No bearer credentials or restricted identity/payment material in interaction logs or telemetry |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- AC1–AC2: Browser accessibility-tree tests confirm Request to Book, Review request, Submit Booking Request, Accept, and checkout are named buttons; no visible button is unnamed in initial, discovery, focused, or closed-workspace states.
- AC3: Assistant turns enter the polite `role="log"`; network errors use the assertive-only error announcer and are not copied into the polite status region.
- AC4: Escape outside the focused workspace leaves it open; Escape inside closes it and returns focus to the reopen control.
- AC5: At 320px and 1280px, new turns scroll into view within the transcript. The transcript and tall workspace each have contained vertical scrolling.
- ADRs: Applied ADR-0078 for keyboard/focus/announcement behavior, ADR-0074 for safe explanatory fallback, ADR-0081 and ADR-0080 for presentation/fallback parity, and ADR-0075 for redaction. No sensitive values were added to telemetry or logs.
- Verification: `npm run check` passed. `npm test` passed with 1,083 passed, 0 failed, 1 skipped. The five S1 browser tests passed. Visual walkthrough completed at 375px and 1280px on the branch server at :3003 because :3001 was already occupied; both viewports had no horizontal overflow and the browser console was clean.
- Implementation commit: `3d2a66b` (`feat(guest): improve chat accessibility semantics`).
