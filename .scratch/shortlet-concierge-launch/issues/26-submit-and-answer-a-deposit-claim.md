# Submit and answer an evidence-backed deposit claim

Status: resolved
Type: AFK
User stories: 59–60

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Open a Security Deposit Claim after authoritative checkout, require timely itemized Operator evidence, achieve Successful Claim Notification, give the guest a 48-hour Claim Response Window, and let an authorized human decide on the Balance of Evidence.

## Acceptance criteria

- [x] Claim timing begins from amended checkout where applicable and rejects unsupported or late submissions under policy.
- [x] Notification status is evidence-backed; the response period starts only after successful notice.
- [x] The Operator bears the full proof burden and cannot rely on arbitrary fees or uncorroborated assertions.
- [x] Claim, response, evidence provenance, reserved amount, decision, and notices remain auditable and tenant-scoped.

## Blocked by

- [Issue 16](16-verify-access-with-live-support.md)
- [Issue 25](25-quote-and-collect-a-security-deposit.md)

## Answer

Implemented the production Issue 26 path through `DepositClaimApplication`, using authoritative BookingState, effective Checkout terms, and the real Issue 25 held-deposit accounting source. Claims have one versioned identity, trusted evidence references, exact 24-hour timing, deterministic no-claim original-source refunds, partial reservation/refund accounting, positive-delivery notification, and an exact 48-hour guest response window. Explicit guest acceptance or dispute is authenticated; silence and disputes go to reused human handoff, and only a trusted human decision provider can apply itemized Balance-of-Evidence adjudication. Unsupported money is refunded and any surviving Operator amount is reserved only; Issue 27 appeal, finality, waiver, and payout behavior is not exposed.

The canonical `shortlet.deposit-claim/v1` artifact, conventional reservation route, and Weaver A2UI v0.9.1 adapter share the same application and strict versioned action contexts. Final corrective validation: 480 passed, 0 failed, 0 skipped, 0 todo. Timely provisional claims recover deterministically and no provisional claim can strand the held deposit. Claim reserve transitions and refund-obligation preparation are invariant-safe; no external refund precedes durable accounting authority. Guest acceptance creates the initial reserved accepted amount. Apply Reviewed Decision is version-bound at the application mutation, with explicit Balance-of-Evidence authority. No-claim artifacts use the actual no-claim refund obligation, notification cannot mutate terminal/no-claim cases, and effective Checkout comes from authoritative terms. Real Human Handoff integration is tested, alongside conventional and Weaver generated-event coverage. Issue 27 remains excluded.

