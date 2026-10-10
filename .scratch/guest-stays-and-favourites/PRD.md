# PRD: Guest stays, reviews, owner messages and favourites

Status: ready-for-agent
Requested: 2 Oct 2026
Decisions approved by the user: 2 Oct 2026
Depends on: `../guest-accounts/` (issues 05 and 06 must be resolved first)

## Problem

The user asked for a guest stay history where a Guest can go back to a stay, rate and review it, and message the owner, plus favourites a Guest can try to book later. None of it exists for Guests:

| Capability | State today | Evidence |
| --- | --- | --- |
| Stay history | Absent. `GET /api/committed-work` lists only live work and skips ended journeys; nothing computes a completed stay | `apps/local-guest/src/guest-server.ts:1479`, `apps/local-guest/src/journey-rail.ts:7` |
| Reviews | Domain only. `VerifiedStayReviewManager` handles `review.submit`, `review.respond`, moderation and `publishAfterExpiry` (ADR 0066), but stores records in an in-memory `Map` and no app calls it | `domains/shortlet/src/verified-stay-review.ts` |
| Guest → owner messages | Absent. Guest threads are with the AI concierge; human handoff goes to platform support; email notifications are one-way | `packages/platform-core/src/human-handoff.ts`, `apps/pilot/src/notifications/pilot-notifier.ts` |
| Favourites | Absent. `AssistantTaskState.shortlist` is the current search only; compare exists but saves nothing | `apps/local-guest/src/assistant/assistant-state.ts:44` |
| Guest account | Being built in `../guest-accounts/` | |

## Goal

A signed-in Guest can see upcoming and past stays, leave the one review a completed stay allows, message the owner about a booking through the platform, and keep a list of favourite apartments they can check and request for new dates later.

## User stories

My stays
1. As a signed-in Guest, I see my upcoming and past stays across all my devices.
2. As a Guest, a stay moves from upcoming to past on its own once it is completed, without a refresh job.
3. As a signed-out Guest who opens "My stays", I am asked to sign in and come back.

Reviews
4. As the Primary Guest of a paid, completed Verified Access stay, I can rate and review it once, within the review window (ADR 0066).
5. As a Guest who is not eligible (not completed, window closed, already reviewed, not the Primary Guest), I see why instead of a form.
6. As an Operator, I can respond once to a review of my unit.
7. As a Guest, my review is published after the Operator responds or the window closes; it is not yet shown on listings.

Owner messages
8. As a Guest with a booking, I can message the Operator about that booking from the stay, and read their replies.
9. As an Operator, I see Guest messages in my inbox and reply there.
10. As either side, I get an email when the other side writes.
11. As either side, I know a message never changes the booking: dates, price, guests and checkout change only through amendments (ADR 0060).
12. As the platform, phone numbers and emails are not exchanged through messages.

Favourites
13. As a Guest, I can save an apartment from its card or its page, and unsave it.
14. As a Guest, I see my saved apartments and can check them for my dates.
15. As a Guest, when a saved apartment is available, I can start a request for those dates in the existing flow.
16. As a Guest, saved apartments that are unpublished or outside the booking horizon say so clearly.
17. As a Guest who saved apartments before signing in, they follow me into my account.

Concierge
18. As a Guest in chat, I can ask "show my stays" or "save this one" and get the same content as the pages.

## Decisions (user, 2 Oct 2026)

- Messaging is a **relayed thread per booking**. The Operator replies from their existing inbox, no contact details are exchanged, messages never change booking terms, both sides get email alerts.
- Favourites are a **saved list with a live availability check** and a "Request these dates" action. There are no "notify me" alerts.
- Reviews are **collected now and shown later**. The rule "no ratings shown" in `../guest-ui-consistency/PRD.md` (ADR 0066 row) stays. Showing reviews is a later, separate decision.

## Domain terms (added to `domains/shortlet/CONTEXT.md`)

- **Completed Stay**: a Reservation whose Contractual Checkout has passed with Verified Access recorded, under the rule settled in issue 01. _Avoid_: past booking, finished trip.
- **Stay History**: the Guest Account's Reservations, split into upcoming and completed. _Avoid_: trips, orders.
- **Stay Message Thread**: the platform-relayed conversation between the Primary Guest and the Operator about one Reservation; it never changes booking terms. _Avoid_: operator message (stays banned for availability and checkout), chat, DM.
- **Saved Stay**: a Unit a Guest Account has saved to revisit. _Avoid_: wishlist, like, shortlist (the shortlist is the concierge's per-search list).

## ADR compliance (read these before any issue)

| ADR | Constraint | Where it bites |
| --- | --- | --- |
| 0004 | Backend owns state; channels are not records | reviews, threads and saves are server records |
| 0012 | Primary Guest occupies and is responsible | only the Primary Guest reviews and messages |
| 0023 | 1 to 14 nights | "Request these dates" validation |
| 0039 | One effective availability result | favourites availability check |
| 0041 | Disclosed requests block 30 minutes; drafts block nothing | checking availability never creates a block |
| 0042 | Daily operator response coverage | owner message notifications |
| 0055 | 90-day horizon | favourites: dates outside the horizon |
| 0060 | Amendments are versioned; external messages change nothing | Stay Message Thread |
| 0066 | One review, paid completed Verified Access stay, 14 days, one operator response, moderation, no ratings shown | reviews |
| 0067 | Web carries the full transaction; WhatsApp bounded | messages are web-only |
| 0072 | Consequential actions are platform commands | `review.submit`, `review.respond`, `message.send`, `favourite.save`, `favourite.remove` |
| 0075 | No identity, payment or contact data in logs or interaction state | message bodies are not logged; redaction |
| 0076 | Automation suspended during human takeover | concierge tools respect takeover |
| 0078 | WCAG 2.2 AA, 44px, 320px reflow, WAT, `en-NG` | every screen |
| 0080 | No-JS parity for critical workflows | every screen and form |
| 0092 / 0093 | Guest accounts and assurance (from `../guest-accounts/`) | sign-in, linked principals |
| 0094 | Relayed stay messages (written in issue 02) | messaging |

## Settled policy values

Settled by the user on 3 Oct 2026 in issue 01 (see its `## Answer` for reasons). Code takes them as constructor options with these defaults.

- **Completed Stay:** at the Contractual Checkout (including accepted amendments), only with Verified Access; no grace period; without Verified Access a stay is "Past" and not reviewable.
- **Message window:** opens at booking confirmation, closes 14 days after checkout; read-only afterwards.
- **Message limits:** 2,000 characters; 20 messages per hour per side per thread.
- **Message retention:** 12 months after the window closes, longer while a deposit claim or appeal is open. **Provisional until legal review.**
- **Contact details:** phone numbers and emails masked with a note to the sender; links refused.
- **Saved Stays:** up to 100 per account; signed-out saving allowed and moved into the account on sign-in.
- **My stays:** confirmed bookings only, Upcoming and Past; cancelled bookings under Past marked "Cancelled"; declined or expired requests not listed.

## Out of scope

Showing reviews or ratings on listings, ranking by reviews, review incentives (banned by ADR 0066), "notify me when available", WhatsApp or SMS messaging, attachments in messages, operator-initiated messages to non-booked Guests, moderation tooling beyond what `VerifiedStayReviewManager.moderateReview` already does.

## Slicing

See `map.md`.

## Verification for the whole effort

- `npm run check` clean; `npm test` green (both phases).
- Walkthrough with the local pilot clock: book, move the clock past checkout, see the stay in "Past", leave a review, Operator responds, review published; send a message, Operator replies, both emails recorded; save an apartment, check dates, start a request.
- Failure paths covered by tests for every story marked with an ineligible state.
- Captures at 320, 390, 768 and 1280, light and dark (issue 14).
