# Guest leaves a review from a past stay

Status: ready-for-agent
Type: task
Blocked by: 04, 05
Requested: 2 Oct 2026

## Why

User stories 4, 5 and 7: the Guest rates and reviews a completed stay from "My stays".

## What to build

- On a past stay (04), a "Leave a review" action opening `GET /stays/mine/<reservation>/review`.
- Form: a rating as a `.ui-segmented` choice (hidden native radios; the labels are the 44px targets) and a comment `.ui-field` textarea. Plain POST form (ADR 0080).
- Submission builds a `review.submit` platform command envelope (ADR 0072) and calls `VerifiedStayReviewManager.submitReview` with `BookingStateForReview` from the issue 03 projection.
- Ineligible states each show a `.ui-banner--neutral` with its reason instead of the form: not yet completed, window closed, already reviewed, not the Primary Guest, no Verified Access. Wording in `guest-content.ts`, agreed with the user.
- After submission: a confirmation that the review is published once the Operator responds or the window closes. The Guest can read their own review and any Operator response on the stay page.
- The form never mentions rewards or incentives (ADR 0066 prohibits them).
- Chat: the concierge links to the form; it does not collect the review itself.

## Acceptance criteria

- AC1: The Primary Guest of a completed Verified Access stay can submit one review within the window and then sees it on the stay page.
- AC2: Each ineligible state shows its own reason and no form; a direct POST in that state is rejected by the domain. One test per state.
- AC3: A second submission for the same stay is rejected and the first review is unchanged.
- AC4: Without JavaScript the form submits and errors keep the typed comment (ADR 0078).
- AC5: No rating or review appears on the unit page, stay cards or search results.

## Tests to add/update

New `test/guest-review-form.test.ts` and a Chromium test with `withStagePage`.

## ADR compliance

0012, 0066, 0072, 0078, 0080. Guest UI rules in `AGENTS.md`.
