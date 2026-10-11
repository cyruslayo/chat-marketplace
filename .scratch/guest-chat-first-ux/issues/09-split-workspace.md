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

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/09-split-workspace.md` (repo root). At 64rem and wider the workspace sits beside the conversation. Below 64rem it is a full-screen sheet above the composer, with one history entry. Header Back, Escape and browser Back share `closeWorkspace`. A text reply leaves the workspace open.
  - Evidence: test/guest-split-workspace-chromium.test.ts (AC1–AC3, real Chromium only). Code: apps/local-guest/src/client.ts (`closeWorkspace`, `syncSheetHistory`); CSS `:has()` layout in apps/local-guest/src/guest-server.ts. Landing: PR #64, commits b6808ee, 81683f2.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
