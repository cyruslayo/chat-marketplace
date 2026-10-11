# Refer Instagram prospects to secure web without booking authority

Status: resolved
Type: AFK
User stories: 101–102, 106

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Provide Instagram prospects with bounded public discovery summaries and secure links into authenticated web while preventing Booking Requests, payment, identity, cancellation, remedies, exact-address release, or Operator financial actions from completing in Instagram.

## Acceptance criteria

- [ ] Instagram projections contain only approved public facts and non-transactional actions.
- [ ] Secure referral preserves lawful context but creates a newly authorized destination session.
- [ ] Free text, acknowledgement, or message delivery cannot create authoritative booking state.
- [ ] Capability and privacy tests reject restricted information and every prohibited completion path.

## Blocked by

- [Issue 01](01-browse-one-eligible-unit.md)
- [Issue 02](02-resume-an-authenticated-interaction-thread.md)

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Evidence: test/refer-instagram-prospects-to-web.test.ts (reconciliation reports 4/4): one test per criterion, in order: `:17` approved public facts only (AC1); `:39` secure referral creates a newly authorized session (AC2); `:55` free text, acknowledgement or delivery cannot create booking state (AC3); `:75` capability and privacy tests reject restricted information and prohibited completion paths (AC4). Implementation: domains/shortlet/src/instagram-adapter.ts. Landing: 9cbd234 ("feat: implement shortlet concierge issues 03, 05, 07, 35", 22 Jul 2026); the files were migrated to TypeScript in 47c72db.
  - Gaps: The issue is blocked by Issue 02 (`02-resume-an-authenticated-interaction-thread.md`); that dependency was not checked in this reconciliation. The issue has no ADR compliance table and no Answer section.
  - Not verified: `npm run check` and `npm test` were not re-run in this reconciliation, and the Definition of Done was not ticked item by item. The acceptance criteria boxes in this file are still unticked; the Definition of Done items were not re-verified.
