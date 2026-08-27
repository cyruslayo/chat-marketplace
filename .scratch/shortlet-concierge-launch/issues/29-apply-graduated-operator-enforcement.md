# Apply graduated Operator and turnover enforcement

Status: blocked
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

Corrective restoration now records an explicit later disposition, preserves immutable incidents and finalized decisions, and excludes only the restored Turnover Suspension from effective Unit projection. Later protective actions remain effective, while Operator-wide pause, termination, unrelated Unit suspension, and ADR-0038 revocation remain unaffected. ADR-0037 restoration classes use authorized human review; OperatorAuthority remains reserved for Operator-originated actions such as appeals, with distinct human and Operator identities in tests.

Production composition remains blocked: no accepted Operator membership or authorization source, and no production construction of `OperatorEnforcementManager`, was found. The server-side `OperatorAuthority` port therefore remains fail-closed by default and is not claimed as production-wired. The generic non-turnover recurrence source gap also remains visible.

ADR evidence applied: 0037, 0038, 0064, 0070, 0072, 0075. The four dedicated top-level acceptance-criterion tests cover the repair.

## Blocked by

- [Issue 05](05-block-and-hold-unit-availability.md)
- [Issue 14](14-qualify-same-day-turnover.md)
- [Issue 17](17-transfer-an-active-matter-to-a-human.md)
