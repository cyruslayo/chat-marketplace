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

Senior-review corrective pass at the current PR #42 branch head. Final classifications now explicitly reference incident reports and deduplicate their root incidents; raw incidents and unrelated finalized actions cannot qualify turnover revocation. Protective availability changes use human-authorized PlatformCommandEnvelope commands, bind tenant scope when created, and support explicit ADR-0037 restoration with the required evidence and approval for each impact class while retaining incident history. Appeals are append-only dispositions: upheld decisions remain effective and exonerated decisions leave projections while necessary protection remains until explicit restoration.

Operator-wide pause and termination project across Units without allowing later Unit decisions to erase them; Unit decisions remain Unit-scoped. Notice delivery is fail-closed for malformed, future, pre-decision, wrong-action, wrong-operator, and wrong-tenant timestamps, preserves successful receipts, and starts the exact seven-day appeal boundary. Operator appeals require the authenticated Operator principal to match the affected Operator and tenant. Egregious two-person approval is limited to the classified egregious turnover path; ADR 0064 supplies authorized human finality without an unsupported generic senior-termination rule.

ADR evidence applied: 0037, 0038, 0064, 0072, 0075. The accepted source gap about generic non-turnover recurrence thresholds remains unresolved; no thresholds were invented. Four dedicated top-level acceptance-criterion tests cover the repair.

## Blocked by

- [Issue 05](05-block-and-hold-unit-availability.md)
- [Issue 14](14-qualify-same-day-turnover.md)
- [Issue 17](17-transfer-an-active-matter-to-a-human.md)
