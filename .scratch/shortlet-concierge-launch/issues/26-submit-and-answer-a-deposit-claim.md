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

Implemented `DepositClaimManager` in `domains/shortlet/src/deposit-claim.ts`.

### ADR Compliance
- **ADR 0016**: Timely claim submission requirement (within 24 hours of contractual or amended checkout); late/unsupported submissions rejected under policy.
- **ADR 0017**: Successful Claim Notification with positive delivery evidence triggers 48-hour guest response window.
- **ADR 0018**: Balance of Evidence standard; operator proof burden; arbitrary fees & uncorroborated assertions rejected; unapproved balance refunded immediately.
- **ADR 0019**: One internal appeal within 7 calendar days.
- **ADR 0020**: Reserved operator award until internal finality. Tenant-scoped audit trail maintained.

