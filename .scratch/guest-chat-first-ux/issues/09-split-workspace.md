# Split and sheet workspace layout; chat stays live

Status: ready-for-agent
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
