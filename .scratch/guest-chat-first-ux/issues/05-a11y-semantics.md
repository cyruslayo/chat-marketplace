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

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/05-a11y-semantics.md` (repo root). Main actions are named buttons. Assistant turns enter the polite `role=log`, and network errors use the assertive announcer only. Escape closes the focused workspace and returns focus to its control. New turns scroll into view inside the transcript at 320px and 1280px.
  - Evidence: test/mobile-guest-journey-chromium.test.ts: AC1 and AC2 (named buttons, no unnamed button), AC3 (polite log, assertive errors), AC4 (Escape), AC5 (scroll into view at 320px and 1280px). Code: apps/local-guest/src/client.ts (announcers, focus handling). Landing: PR #50, merge c14e91b (implementation commit 3d2a66b).
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
