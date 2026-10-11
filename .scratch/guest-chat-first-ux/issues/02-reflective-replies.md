# Replies restate what the concierge understood

Status: resolved
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
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/02-reflective-replies.md` (repo root). Clarify replies open with "So far I have" and restate every known criterion, then ask one question in where, who, when, nights order. Unsupported preferences (quiet, pool, parking and similar) get a note and are not applied to the search. `formatGuestDay` uses en-NG (ADR-0077).
  - Evidence: test/guest-reflective-replies.test.ts (one test per AC). Code: apps/local-guest/src/concierge.ts (`clarifyReply`, `unsupportedPreferences`). Landing: PR #54, commit 169e9ac.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
