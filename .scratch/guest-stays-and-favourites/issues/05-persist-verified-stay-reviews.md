# Persist Verified-Stay Reviews

Status: ready-for-agent
Type: task
Blocked by: 03
Requested: 2 Oct 2026

## Why

`VerifiedStayReviewManager` (`domains/shortlet/src/verified-stay-review.ts`) already enforces ADR 0066 (`submitReview` with `review.submit`, `submitOperatorResponse` with `review.respond`, `publishAfterExpiry`, `moderateReview`), but keeps records in an in-memory `Map`. Reviews written by a Guest would vanish on restart. Issue 32 of `shortlet-concierge-launch` built the domain rules; this issue makes them durable.

## What to build

- A `VerifiedStayReviewStore` interface with in-memory and SQLite implementations, following the repository pattern in `domains/shortlet/src/booking-state.ts` (JSON record column, `revision`, `BEGIN IMMEDIATE`).
- `VerifiedStayReviewManager` takes the store through its constructor; the existing tests keep passing with the in-memory store. Every injected dependency is used (Definition of Done item 4).
- Publication: a review in `pending_operator_response` is read as published once the window closes, evaluated lazily on read (AGENTS anti-pattern 2), and `publishAfterExpiry` persists that transition when called.
- Lookups needed by later issues: by reservation (one review per booking), by unit for the Operator, by account for the Guest.
- `getUnitReviewMetrics` stays unused by any Guest screen (collect now, show later).

## Acceptance criteria

- AC1: A submitted review survives a restart (new store instance, same database).
- AC2: A second review for the same booking is rejected, including after a restart and under two concurrent submissions.
- AC3: A pending review reads as published after the window closes, with no background job. Failure path: before the window closes and with no response, it is not published.
- AC4: An Operator response survives a restart, and a second response is rejected.
- AC5: Existing `test/publish-verified-stay-review.test.ts` passes unchanged against the in-memory store.

## Tests to add/update

New `test/verified-stay-review-store.test.ts`; keep `test/publish-verified-stay-review.test.ts`.

## ADR compliance

0004, 0066, 0072, 0075.
