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

Production Issue 27 extends the durable Issue 26 claim record rather than using `DepositClaimManager`. Full-decision receipt is a separate, per-party notice authority; the Issue 26 Claim notice and 48-hour response window never start the appeal clock. Receipt is established only by positive delivery evidence or authenticated direct viewing, with an exact seven elapsed-day UTC deadline and deterministic WAT presentation. Each eligible party has one versioned appeal, with the four exact grounds, trusted evidence references, independent human review attestations, and version-bound reviewed dispositions.

Approved Operator awards remain reserved through Internal Finality. Guest acceptance is represented as an accepted outcome and is not a waiver. Waiver is an explicit authenticated, claim/decision-specific command; viewing, silence, prior acceptance, and general terms do not waive rights. The existing Security Deposit accounting collection is extended with durable Operator award obligations, replay-safe provider settlement, one balanced journal, and no Guest refund clawback. Appeal reductions create separate deterministic Guest refund obligations; unsupported increases fail closed because no approved funding authority exists.

Failed full-decision notices use `submittedAtIso` as the authoritative timeline anchor. Day 14 creates one assisted-review handoff, Day 45 creates a real Guest refund obligation for the remaining reserve, and Day 90 records durable closure; progression is idempotent. The implementation preserves the accepted late-appeal minimum: failed delivery does not consume appeal rights through Day 90, Day-45 release is not clawed back, and closure does not recreate ordinary rights. No source defines a more specific late-appeal remedy.

The canonical `shortlet.deposit-claim` artifact now projects decision identity, receipt/finality facts, appeals, settlement state, milestones, exceptions, and a WAT deadline through Weaver Basic Catalog v0.9.1 without provider or security leakage. Production tests cover durable receipt/direct-view replay, acceptance-versus-waiver, artifact parity, award identity/replay/journaling, and existing Issue 26 regressions.

Local validation: `npm run check`, `npm run verify:weaver`, and full `npm test` all pass: **492 passed, 0 failed, 0 skipped, 0 todo** (delta +4 from 488). `git diff --check` passes. Implementation commit: `0212607`.

## Blocked by

- [Issue 26](26-submit-and-answer-a-deposit-claim.md)
