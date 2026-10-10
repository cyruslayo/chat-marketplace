# Accessibility semantics pass

Status: ready-for-agent
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

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.
