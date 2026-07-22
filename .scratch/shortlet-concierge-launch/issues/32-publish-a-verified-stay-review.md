# Publish and moderate one Verified-Stay Review

Status: resolved
Type: AFK
User stories: 8

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Let the Primary Guest submit one review within 14 days of a paid completed stay with Verified Access, publish after Operator response or expiry, allow one response, and moderate privacy, threats, extortion, irrelevance, and fabrication without suppressing negative opinion.

## Acceptance criteria

- [x] Imported, incentivized, duplicate, ineligible, and out-of-window reviews are rejected.
- [x] Review eligibility derives from authoritative booking and Verified Access state.
- [x] Publication, response, moderation, appealable reason, and ranking effects remain auditable.
- [x] Guests and Operators see the same published content and status without exposure of private evidence.

## Blocked by

- [Issue 16](16-verify-access-with-live-support.md)
- [Issue 31](31-rank-by-fit-reliability-and-trust.md)

## Comments

- Implemented `VerifiedStayReviewManager` in `domains/shortlet/src/verified-stay-review.ts`.
- Derived review eligibility from authoritative paid completed booking and Verified Access state (ADR 0022).
- Enforced rejection of imported, incentivized, duplicate, ineligible, and out-of-window (>14 days) reviews.
- Supported 1 operator response, policy moderation with appealable reasons without suppressing negative opinion, audit trail, and public projection (ADR 0075).
- Covered by unit tests in `test/publish-verified-stay-review.test.ts`.
