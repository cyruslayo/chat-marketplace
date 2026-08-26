# Let the guest choose relocation or Refund Fallback

Status: resolved
Type: AFK
User stories: 54–57

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

For a qualifying failure, present the Primary Guest with comparable relocation candidates and a full-refund choice, enforce bounded human spending authority, capture explicit selection, and guarantee Refund Fallback when an acceptable replacement cannot be completed.

## Acceptance criteria

- [x] Replacement comparison preserves capacity, location, quality, safety, dates, price difference, transport, and material disclosures.
- [x] Routine, senior, and executive relocation limits require the accepted human roles and approvals.
- [x] The guest is never forced to relocate and temporary substitution requires consent.
- [x] Choice, funding source, Operator liability, booking consequences, and resulting projection are committed atomically and audited.

## Answer

- Qualifying failure is supplied by authoritative upstream state; the client cannot assert it.
- Only the authenticated Primary Guest chooses; client candidate, approval, and boolean-consent authority are removed.
- Candidates and availability are trusted/versioned, with comparability before provider-owned affordability approval.
- Candidate-specific consent, original-source refund, remaining-stay economics, and automatic Refund Fallback are wired through a shared versioned case.
- Mid-stay obligations are consumed from the Issue 22 boundary; funding route and Operator liability remain separate.
- Guest Protection Fund movement remains Issue 24.
- Conventional and Weaver A2UI projections share the canonical artifact and strict server events.
- Local validation: 402 passed, 0 failed, 0 skipped, 0 todo; baseline delta +3.

## Blocked by

- [Issue 17](17-transfer-an-active-matter-to-a-human.md)
- [Issue 22](22-remedy-a-mid-stay-failure.md)
