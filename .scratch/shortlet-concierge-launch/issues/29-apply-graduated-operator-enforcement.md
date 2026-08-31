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

## Completion

ADR-0082 representative authority is now production-integrated for Operator appeals through the durable SQLite representative-grant store. Missing, revoked, expired, and cross-scope authority fails closed; restoration remains human authority rather than Operator representative authority. Full validation passed.

## Answer

Corrective restoration now records an explicit later disposition, preserves immutable incidents and finalized decisions, and excludes only the restored Turnover Suspension from effective Unit projection. Later protective actions remain effective, while Operator-wide pause, termination, unrelated Unit suspension, and ADR-0038 revocation remain unaffected. ADR-0037 restoration classes use authorized human review; OperatorAuthority remains reserved for Operator-originated actions such as appeals, with distinct human and Operator identities in tests.

ADR-0082 defines explicit Operator representative authority, and the durable SQLite representative-grant runtime is merged. Issue 29 consumes `OperatorRepresentativeAuthority`; appeal authority fails closed for missing, revoked, expired, or cross-scope grants. The manager retains a fail-closed default when no source is supplied, and explicit dependency injection makes it production-composable. Restoration authority remains authorized human authority, not Operator representative authority.

All four Issue 29 acceptance criteria are complete. Full validation passes. ADR evidence applied: 0037, 0038, 0064, 0070, 0072, 0075, 0082. Issue 30 remains out of scope.

## Blocked by

- [Issue 05](05-block-and-hold-unit-availability.md)
- [Issue 14](14-qualify-same-day-turnover.md)
- [Issue 17](17-transfer-an-active-matter-to-a-human.md)
