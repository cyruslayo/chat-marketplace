# Conventional offer and booking pages for linked devices and the offer's own Guest

Status: ready-for-human
Type: task
Blocked by: 06
Requested: 11 Oct 2026

## Why

The offer gate lets an authorized Guest through, and then the page refuses them. Issue 06 Q3 found this on `origin/main` before the account work: the conventional offer and booking pages return `404 BOOKING_RECORD_NOT_FOUND` for an authorized owner.

- `GET /conditional-offers/:id` is routed at `apps/local-guest/src/guest-server.ts:5571`. The offer gate is `offerAuthorized` (`guest-server.ts:6641`), called from the offer-route check at `:7652` and fail closed on lookup error (issue 06 Item 2(b), test "fail-closed contract of the offer gate").
- The offer POSTs (`/conditional-offers/:id/accept|conversation|search`, matched at `guest-server.ts:7885`) and the booking-request pages return `404 BOOKING_RECORD_NOT_FOUND` (`guest-server.ts:7835`, `:7919`, `:8000`) because those pages are built from the conversation projection, which does not carry the offer (issue 06 Comments, Q3).
- The payment page `/payments/offers/:id` works for the owner (issue 06 Comments, Q3), so the gap is limited to the conventional offer and booking pages.
- Affected: (1) a linked second device (same account, different principal), and (2) the offer's own Guest on the same device. Issue 08 Comments (b) records that these still refuse and that issue 08 did not cover them.

## Question for the human (decision recorded in issue 06 Needs human)

Issue 06 lists "Decision: conventional detail pages for linked principals" as a human decision. The acceptance criteria below are the intended behaviour from the request that filed this issue. The human should confirm them before implementation.

1. Confirm that a linked second device and the offer's own Guest on the same device should be able to open and act on their own offers and bookings from the conventional pages (not only the payment page).
2. Confirm that a stranger keeps getting the identical 404 (`BOOKING_RECORD_NOT_FOUND` and the offer equivalent), so that existence is not leaked.
3. Confirm the fallback when the conversation projection does not carry the offer: build the page from the offer and request records under the same authorization check (preferred, since the projection cannot be the authority, ADR 0004), or keep the refusal and show a link to the payment page only.

## Proposed acceptance criteria (pending the human's answers above)

- AC1: A linked second device can open `GET /conditional-offers/:id` for an offer on its account's requests, and can perform accept, conversation and search on it.
- AC2: The same Guest on the same device, with the offer's own principal, can open and act on their own offer.
- AC3: A stranger (no link, different principal) gets the identical 404 body as for a missing offer, with no offer id echoed.
- AC4: The offer-id gate (`offerAuthorized`) stays fail closed: a lookup that throws returns false (existing test kept).
- AC5: Booking-request pages for the same principals follow the same rule as AC1 to AC3.

## ADR compliance

| ADR | Constraint | Affected path |
| --- | --- | --- |
| 0093 | Linked principals see their account's work; claims are per request; conflicts fail closed | `guest-server.ts:6641`, `:7652` |
| 0094 | Missing or conflicting ownership grants no account authority | AC3 |
| 0004 | Backend owns authoritative state; the projection is not the authority | Question 3 |
| 0070 | Interaction and domain identities are separate | AC1 and AC2 (principal vs account) |
| 0075 | Refusals do not echo ids or restricted material | AC3 |
| 0080 | Chat and standalone page parity | Any new page content |
| 0078 | 320 to 1280 layout and 44px targets | Any changed screen |

## Comments

- 11 Oct 2026, filed from issue 06 Comments Q3 and Needs human ("Decision: conventional detail pages for linked principals"), issue 07 Comments (the 06 Q3 note, which hands it to issue 08), and issue 08 Comments (b). Lines re-checked on `origin/main` 8b23923.
- Pre-existing on `origin/main`: the refusal is not a regression from issue 06.
