# Appeal and finalize a deposit claim

Status: resolved
Type: AFK
User stories: 61–62

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Allow one timely Claim Appeal after successful decision notice, route it to an independent authorized human, reserve approved awards until Internal Finality, and close failed-notification cases under the accepted Day 14, Day 45, and Day 90 rules.

## Acceptance criteria

- [x] Appeal eligibility, deadline, independence, evidence, and final decision are explicit and versioned.
- [x] Approved Operator awards remain reserved until internally final and cannot be paid twice.
- [x] Notification failure follows independent review, reserve-release, late-appeal, and closure deadlines exactly.
- [x] Fraud, regulator, court, and legal-hold exceptions preserve records without silently reopening ordinary appeal rights.

## Answer

The corrective pass keeps the real Issue 26 production record/repositories and does not use `DepositClaimManager`.

- Guest and Operator now persist distinct full-decision receipt timestamps, sources, and seven-elapsed-day UTC deadlines; the earliest valid delivery/direct-view receipt wins. Viewer artifacts expose the matching party deadline in WAT.
- Appeals use the authenticated caller's own window. Both parties can file one appeal independently, and all four allowed grounds call trusted evidence validation; new-material evidence additionally requires positive `genuinelyNewMaterial` authority.
- Human appeal application rejects `system`, `agent`, and `model` actors, requires authorized staff/admin tenant scope, rejects the original adjudicator even when provider independence assertions are false, and preserves the immutable original adjudication snapshot while changing only the current outcome.
- Whole-claim Internal Finality now waits for both applicable party gates and unresolved appeals. Guest waiver records only the Guest gate and cannot bypass an open or pending Operator authority. Guest refunds are not clawed back; reductions use distinct `appeal-adjustment` obligations.
- Award identity checks include collection, reservation, claim, operator, tenant, amount, and currency. Pending/settled award replay produces one balanced journal. Failed Guest decision notice uses `submittedAtIso`: Day 14 assisted review, Day 45 real Guest refund obligation, and Day 90 durable closure, including the exact boundary tests.
- Consequential repair operations carry PlatformCommand provenance in durable history. Canonical artifact/A2UI tests prove per-party deadlines, WAT output, Basic Catalog 0.9.1, and sensitive-data redaction.

LOCAL validation: `npm run check`, `npm run verify:weaver`, and full `npm test` pass: **503 passed, 0 failed, 0 skipped, 0 todo** (delta +11 from 492). `git diff --check` passes. Implementation commit: `883d84c`.

## Blocked by

- [Issue 26](26-submit-and-answer-a-deposit-claim.md)
