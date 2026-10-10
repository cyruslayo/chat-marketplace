# Operator responds to a review

Status: ready-for-agent
Type: task
Blocked by: 05
Requested: 2 Oct 2026

## Why

ADR 0066 gives the Operator one response, and publication waits for it or for the window to close. Without an Operator screen, every review would publish only by expiry.

## What to build

- In `apps/local-owner` (`local-owner-server.ts`, `back-office-view.ts`): a "Reviews" list for the signed-in Operator's units, showing pending and published reviews with the window deadline in WAT.
- A response form (plain POST) that sends a `review.respond` envelope to `VerifiedStayReviewManager.submitOperatorResponse`. Authority comes from the ADR 0082 representative grant, as for other Operator actions.
- A new `NotificationKind` `operator.review_received` in `apps/pilot/src/notifications/pilot-notifier.ts`, sent when a review is submitted, to the response-coverage contacts (ADR 0042). The email does not contain the review text if issue 01 or ADR 0075 says so; it links to the Reviews list.

## Acceptance criteria

- AC1: An Operator with a valid grant sees reviews of their units only. Failure path: another Operator's review is not listed and its response POST is refused.
- AC2: Responding once publishes the review; a second response is rejected.
- AC3: A revoked grant denies the response even with a live session (ADR 0086).
- AC4: Submitting a review records one `operator.review_received` notification.

## Tests to add/update

New `test/operator-review-response.test.ts`; extend the notifier tests.

## ADR compliance

0042, 0066, 0072, 0075, 0082, 0086.
