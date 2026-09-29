# Request screens: draft, review, sent, not accepted

Status: ready-for-agent
Type: task
Blocked by: 03, 04
Requested: 29 Sept 2026

## Why

The request stage has four states. Each renders in the chat workspace (the request-draft and booking-request surfaces) and as a conventional page (`/booking-requests/drafts/:id`, `/booking-requests/:id`, via `renderConventionalBookingHtml`). The design (`design/RequestDraft`, `RequestReview`, `RequestSent`, `RequestOutcome`) gives all four one layout.

## What to build

For each state, in both the chat workspace and the conventional page:
- **Head:** eyebrow "Booking Request", serif title, a status pill with the domain's status text (for example "Not sent yet · your dates are not reserved", "Waiting for …").
- **Stay ticket** (issue 02).
- **Price breakdown**, with the "If your request is accepted" condition tag and the amount-due line, in the states where it exists today (d2dfced's `amountDueNowIsConditional` flag).
- **"What happens next"** as `.ui-steps`. The step text comes from the existing copy (`guestWaitingGuidance` and the request-pending lines in `guest-content.ts`, and the draft fallbacks). The design's step wording is illustrative; don't add new promises. If a step has no source copy, ask.
- **Draft:** a "Who's staying" card (guests; self-booking attestation from the draft), "Change dates or guests", and the action bar with "Review request".
- **Review:** the action bar with "Send request".
- **Sent:** a neutral banner saying nothing is payable yet, then "Back to your conversation". The request-pending waiting panel becomes this banner plus the steps (no info-blue box).
- **Not accepted** (declined or expired outcomes): the rail's failed step (issue 03), a neutral banner, "Find other stays" and "Back to your conversation".

## Acceptance criteria

- AC1: Each of the four states renders the same head, ticket, breakdown and actions in the chat workspace and on its conventional page. One parity test per state.
- AC2: Before acceptance, the breakdown carries the "If your request is accepted" tag, and it never does on an offer or later screen (extend the d2dfced test).
- AC3: The request-pending chat state shows the neutral banner and steps, and no longer renders `.waiting-panel` (update `guest-waiting-states-chromium.test.ts`).
- AC4: A declined or expired request shows the failed rail step and both actions. "Find other stays" keeps the Guest's criteria (existing behaviour, asserted).
- AC5: Without JavaScript, each conventional request page renders fully and its primary action works (form post), as today.

## ADR compliance

0006 (provider named only where the contract can form), 0015, 0072, 0078, 0080.

## Comments
