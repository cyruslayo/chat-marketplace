# New conversation without losing committed work

Status: resolved
Type: task
Blocked by: 09
Parent: [13](13-thread-control.md)

## What to build

Add a "New conversation" control. It starts a new thread (the thread id lives in sessionStorage, `client.ts:56`) without the fixture-only `/api/reset` (`guest-server.ts:2297`). When a request is live, confirm in the page first and say the request is unaffected.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC1: Starting a new conversation doesn't withdraw or cancel an existing Booking Request, and says so.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0079 | Starting over never cancels committed work |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- **Control.** A "New conversation" button in the shell header, beside Contact details. Below 30rem it reads "+ New"; its accessible name stays "New conversation" (WCAG 2.5.3), and the header stays one row at 320px.
- **No reset (ADR-0079).** `startNewConversation` in `client.ts` writes a new `g-<uuid>` to the `shortlet-concierge-thread` sessionStorage key and reloads `/`. It never calls `/api/reset` and sends no command, so nothing in the old thread changes.
- **Says so (AC1).**
  - `LocalGuestApp.committedWork(principal)` lists the Guest's live Booking Requests, offers and Reservations across all of their threads. Each item has its kind, conventional route and apartment title.
  - It is derived from `#journeyFor`, so declined, expired and not-delivered records, and Request Drafts, are never listed. It fails closed to `[]` for any other principal, role or tenant.
  - It is served at `GET /api/committed-work`, keyed by the session principal, never by a client thread id. It returns 401 without a session.
  - With live work, the button opens an in-page confirmation (`role="group"`, focus moves to "Start new conversation"; "Stay here" or Escape cancels and returns focus). It reads: "Starting a new conversation doesn't withdraw or cancel your Booking Request for {apartment}…" and links to the record's page. If the check can't be read, it still confirms with a generic line. With no live work, the new conversation starts at once.
  - An empty conversation shows "Your {Booking Request} for {apartment} is still active. Starting this conversation didn't change it." with a link.
  - Wording: `guestNewConversationCopy` and `GUEST_NEW_CONVERSATION` in `guest-content.ts`.
- **No JavaScript (ADR-0080).** The `/conversation` page has a "New conversation" link. `GET /conversation` without a `threadId` redirects (303) to a fresh id, and an empty no-JS conversation shows the same "still active" lines.
- **Tests.**
  - `test/guest-new-conversation.test.ts`: AC1 (the request stays `disclosed`, the old thread is unchanged, the Operator can still confirm, and the notice and link are shown; the no-JS route too). Failure paths: no live work, or only a draft, gives no confirmation; declined and expired requests aren't listed; other principals, roles and tenants get nothing; a forged or missing session gets 401.
  - `test/guest-new-conversation-chromium.test.ts`: at 375px and 1280px, the confirmation, cancel by button and by Escape, and the new thread with its notice; at 320px, no confirmation without live work, and no horizontal scroll.
  - `sendRequest` moved to `test/helpers/guest-browser.ts` and is shared with the waiting-states browser test.
- Verification: `npm run check` passed. `npm test`: 1,157 passed, 1 failed, 1 skipped. The failure was cross-tab RB1, which is known-flaky under load, and it passed when rerun alone. Walkthrough on :3001 at 375px, 1280px and 320px.
- **Review fix (M4 review, 26 Sept 2026).** A thread records its offer only on its next refresh. So when the Operator confirmed while the Guest's tab was closed, an expired Conditional Booking Offer was still listed as a live Booking Request.
  - `committedWork` now adopts the durable offer for a confirmed request (`findConditionalOfferByRequestId`, read-only; it never issues one) and judges that offer.
  - Test: "an offer the original tab never saw is judged as the offer, and an expired one is not live".
