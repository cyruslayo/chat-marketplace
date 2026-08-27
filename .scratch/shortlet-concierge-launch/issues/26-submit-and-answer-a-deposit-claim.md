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

The canonical `shortlet.deposit-claim/v1` artifact, conventional reservation route, and Weaver A2UI v0.9.1 adapter share the same application and strict versioned action contexts. Corrective local validation: 476 passed, 0 failed, 0 skipped, 0 todo. The repair adds failure-safe claim allocation, explicit policy/evidence version binding, coherent partial-refund accounting with real collection journals, durable refund obligations and no-claim cases, decision-freshness binding, real Human Handoff reuse, conventional routing, and generated Weaver Accept/Dispute/Apply coverage. Issue 27 remains excluded.

