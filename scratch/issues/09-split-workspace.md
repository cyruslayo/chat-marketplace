# Split and sheet workspace layout; chat stays live

Status: resolved
Type: task
Blocked by: 08
Findings: F5 (see ../PRD.md)

## What to build

At 64rem and wider, show the transcript and the focused workspace side by side. Below that, the workspace is a full-screen sheet with a header Back button and browser Back support. The composer stays usable while the workspace is open, and a typed refinement updates the active surface. Builds on the modes already in `apps/local-guest/src/conversational-shell.ts`.

## Acceptance criteria

- AC1: At 1280px, transcript and workspace are both visible with no dead space above the workspace.
- AC2: At 375px, the workspace opens as a sheet, and both browser Back and header Back close it.
- AC3: Sending a message while the workspace is open keeps it open and updates it where relevant.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0078 | Focus stability and reflow |
| 0073 / 0081 | Weaver is presentation only |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- **Markup.** The criteria strip and the composer moved inside `<main>`, after the workspace-reopen button. The mobile order is unchanged: transcript, workspace, reopen, strip, composer. The skip link and the `main-content` target are unchanged, and the announcers now follow `<main>`.
- **Split at 64rem and wider (AC1).**
  - While `#active-workspace` is visible, `.app` widens to `--layout-app-max` and `<main>` becomes a two-column grid: transcript, reopen, strip and composer on the left, the workspace on the right spanning every row.
  - The workspace starts at the top of `<main>` and scrolls on its own, so there is no dead space above it.
  - With no workspace, the layout stays one column.
  - It is pure CSS (`:has()`), so no JavaScript decides the layout.
- **Sheet below 64rem (AC2).**
  - An active focused surface makes `#workspace-region` a fixed, full-screen sheet with the existing "Back to conversation" header button. The sheet stops above the composer (`--composer-block-size`, kept up to date by a `ResizeObserver`), and the composer stays above it.
  - While the sheet is open the page holds one `history.pushState({ shortletSheet: true })` entry, so browser Back fires `popstate`, which closes the sheet and stays on the page.
  - Header Back, Escape and any render that ends the sheet (an inline surface, a fallback, a resize past 64rem) remove that entry with `history.back()` in `syncSheetHistory`.
  - Header Back, Escape and browser Back share one `closeWorkspace`, so focus returns and closing is announced the same way every time (ADR-0078).
  - Inline results are not a sheet.
- **Chat stays live (AC3).** A text reply leaves the workspace and the sheet open. A refinement that returns new results updates the workspace in place, and on desktop the split remains. ADR-0073/0081: the layout is shell presentation only, and Weaver still renders the surfaces.
- **Tests.** `test/guest-split-workspace-chromium.test.ts` covers AC1–AC3 in real Chromium.
  - AC1 at 1280px, for results and for stay detail: side by side, workspace within 24px of the top of `<main>`, composer under the transcript, no overflow.
  - AC2 at 375px: a fixed full-screen sheet that doesn't cover the composer, one history entry, header Back and browser Back both close it, and the page stays on the conversation.
  - AC3 at 375px (the sheet stays open after a question) and at 1280px (a typed refinement updates the results in place).
  - Failure paths: no second column without a workspace, and inline results are not a sheet.
- **Resolved after review.** The criteria strip was 105–157px tall at 375px in the conversation view. It now collapses to a one-line summary with an "Edit search" toggle, fixed on S10a and rebased up the stack (user decision, 26 Sept 2026).
- Verification: `npm run check` passed. The first full `npm test` had 1,130 passed, 17 failed and 1 skipped, all load failures: a Chrome DevTools connection failure, and one `pilot-local` timeout that cascaded into 12 dependent tests. Every failing file passes alone. The rerun: 1,147 passed, 0 failed, 1 skipped. Walkthrough on :3005: at 1280px the split shows the stay detail on the right, from the top; at 375px the full-screen sheet opens with the composer usable, and resizing from 1280px with the stay open turns it into a sheet.
