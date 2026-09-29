# Confirmation and system pages: confirmed, error pages, conversation without JavaScript

Status: ready-for-agent
Type: task
Blocked by: 03, 04
Requested: 29 Sept 2026

## Why

The end of the journey and the edges must look like the same product: the confirmed reservation (chat and `/booking-contracts/:id`), every error page (`errorPage` in `apps/web/src/ui-kit.ts`, used through `sendPageError`), and the server-rendered conversation for browsers without JavaScript (`renderNoScriptConversationHtml`). Designs: `design/Confirmed`, `ErrorPage`, `NoJsConversation`.

## What to build

- **Confirmed:**
  - a success pill "Stay payment verified", then the ticket with the booking reference in the foot
  - the paid breakdown: total, deposit collected, "Amount paid" (today's value; see issue 12)
  - "Before you arrive" as `.ui-steps`, from the existing confirmation copy (check-in details shared later; a confirmed booking doesn't itself grant access; the full contract is in booking details)
  - "Back to your conversation" and "View booking details"
- **Error pages:** `errorPage` renders inside the app bar (no rail: an error isn't a journey step), with the `.ui-empty` card, a pill primary action, and the machine code kept in the markup (`data-error-code`). Applies to every `sendPageError` status.
- **Conversation without JavaScript:** the same app bar, rail, bubbles, markers, result rows for surfaces (their text fallback plus a link to the conventional route) and composer as the chat. The submit is a real "Send" button (issue 06c behaviour unchanged).

## Acceptance criteria

- AC1: The confirmed reservation renders the same ticket, paid breakdown, steps and actions in the chat workspace and on `/booking-contracts/:id`. Parity test.
- AC2: Every error page (400, 401, 403, 404, 409, 500 paths) renders the app bar, the empty-state card and one primary action, and keeps `data-error-code` and `data-status`. One test per status family.
- AC3: The no-JavaScript conversation uses the chat's app bar, rail, bubbles and composer classes, and each surface appears as a result row linking to its conventional route. Real Chromium with JavaScript disabled (extend `guest-no-js-composer-chromium.test.ts`).
- AC4: Without JavaScript, posting a turn from that page still produces a server-rendered reply (the existing 06c test still passes).

## ADR compliance

0078, 0080, 0075 (no identifiers beyond today's in error pages).

## Comments
