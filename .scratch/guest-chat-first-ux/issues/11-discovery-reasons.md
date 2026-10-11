# Discovery fit reasons and contextual quick replies

Status: resolved
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

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/11-discovery-reasons.md` (repo root). `fitReasons` gives up to three reasons, each tagged with its source field, and nothing is inferred. The indicative-rates footnote appears only when dates or party size are unknown. Quick replies offer phrases the interpreter already parses. The two-column grid is removed at 48rem and wider.
  - Evidence: test/guest-discovery-reasons.test.ts (AC1–AC3); test/guest-discovery-reasons-chromium.test.ts (AC4 at 375px and 1280px). Code: apps/web-agent/src/discovery-a2ui.ts (`fitReasons`); domains/shortlet/src/browse.ts (`INDICATIVE_RATES_DISCLOSURE`); apps/local-guest/src/concierge.ts (`quickRepliesFor`). Landing: PR #63, commit da056d0.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
