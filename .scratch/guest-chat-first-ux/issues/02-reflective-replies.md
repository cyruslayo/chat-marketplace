# Replies restate what the concierge understood

Status: ready-for-agent
Type: task
Blocked by: 01
Findings: F1 (see ../PRD.md)

## What to build

Replace "I've kept what you've already told me" in `clarifyReply` (`concierge.ts`) with a reply that lists the understood criteria (area, dates, guests, preferences) and asks only for the next missing one. Mention input that was not understood instead of dropping it.

## Acceptance criteria

- AC1: Each clarify reply names every criterion that is known.
- AC2: Each clarify reply asks for exactly one missing criterion.
- AC3: A preference word the parser does not support (for example "quiet") is acknowledged as not yet filterable, not silently dropped.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0077 | Canonical meaning across channels; en-NG dates |
| 0004 | Backend owns the criteria state that is reflected |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 28 Sept 2026: the audit for launch-readiness issue 10 found this work implemented and tested on main, but this file was never set to resolved. The status is left for a human to confirm against the Definition of Done.
