# Discovery fit reasons and contextual quick replies

Status: ready-for-agent
Type: task
Blocked by: 03b
Findings: F11 (see ../PRD.md)

## What to build

Add up to three fit reasons per card, computed from unit data against the criteria ("sleeps 2 exactly", "backup power"). Suggest quick replies that match the missing criterion or common refinements. Make the result card full width. Show the "indicative rates" footnote only when dates are missing.

## Acceptance criteria

- AC1: Every fit reason can be traced to a unit field. Units without data show no reason.
- AC2: The footnote is absent when dates and party size are known.
- AC3: After a clarify reply, the quick replies match the missing criterion.
- AC4: The card fills the transcript column width.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0015 | All-in price on every card |
| 0066 | Specific trust claims only |
| 0008 / 0009 | Inspection evidence wording |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.
