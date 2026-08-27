# Apply graduated Operator and turnover enforcement

Status: resolved
Type: AFK
User stories: 75–77, 92

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Turn calendar errors, cancellations, substitutions, response failures, negative balances, turnover defects, safety failures, and control circumvention into published evidence-based enforcement from coaching through restriction, suspension, pause, and termination, with protective action and one appeal.

## Acceptance criteria

- [x] Severity, recurrence, attribution, restoration, revocation, and egregious-event thresholds follow accepted policy.
- [x] Provider/platform faults and extraordinary events do not count as Operator misconduct.
- [x] Immediate protection is distinguished from the independent human final decision and seven-day appeal.
- [x] One underlying incident is not multiplied by downstream reports, and every affected feature or Unit projection updates consistently.

## Answer

Corrective productionization pass from `a558278ea0bdc82a69d76d7756688cb49c4c358b`. Issue 29 acceptance criteria are checked and backed by four dedicated tests in `test/apply-graduated-operator-enforcement.test.ts`.

The repair removes unsupported generic two/three-incident punitive thresholds; only ADR 0037/0038 turnover rules are automatic/source-backed, with human final classification and required two-person egregious turnover approval. It binds appeals to successful notice timestamps, one ordinary appeal, exact seven-elapsed-day timing, opaque evidence references, tenant scope, and independent authorized human command principals. Protective actions and finalized decisions are represented separately and drive projections without treating evidence alone as a final decision. Root incidents and excluded attribution classes remain correctly handled.

ADR evidence applied: 0037, 0038, 0039, 0042, 0064, 0067, 0072, 0075. Validation: focused Issue 29 tests 4/4; `npm run check` passes; `npm run verify:weaver` passes; full `npm test` 504 passed, 0 failed, 0 skipped, 0 todo; `git diff --check` passes. Issues 27, 30, and 35 and all ADR files were untouched. No dependencies changed.

## Blocked by

- [Issue 05](05-block-and-hold-unit-availability.md)
- [Issue 14](14-qualify-same-day-turnover.md)
- [Issue 17](17-transfer-an-active-matter-to-a-human.md)
