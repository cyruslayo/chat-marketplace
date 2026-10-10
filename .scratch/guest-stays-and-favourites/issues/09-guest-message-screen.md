# Guest message screen on a stay

Status: ready-for-agent
Type: task
Blocked by: 04, 08
Requested: 2 Oct 2026

## Why

User stories 8 and 11: from a stay, the Guest reads and writes messages to the Operator, and understands that messages do not change the booking.

## What to build

- "Message the owner" on a stay (04) opens `GET /stays/mine/<reservation>/messages`, rendered by one helper used by both the standalone page and the chat workspace (guest UI kit rule).
- The message list reuses the existing transcript bubble styling. If the kit has nothing suitable, add exactly one component to the "Guest UI kit" block of `apps/web/src/shortlet-foundations.css` and to the list in `docs/design/shortlet-design-system-direction.md`, with semantic tokens only; do not reformat the file.
- A plain POST composer (`.ui-field` and `.ui-button`), working without JavaScript. With JavaScript, new messages appear without reload and are announced politely (ADR 0078 live updates).
- A standing `.ui-banner--neutral` line: messages don't change your booking; for dates, guests or checkout use the booking actions or support. The links go to the existing amendment or support paths. Wording in `guest-content.ts`, agreed with the user.
- Window closed: the composer is replaced by a `.ui-banner` with the reason and the support route.
- Times shown in WAT.

## Acceptance criteria

- AC1: The Guest sends a message and sees it in the list; an Operator reply (seeded) appears in the list.
- AC2: Without JavaScript, sending works and a refused message (limit, contact detail, closed window) shows its reason and keeps the typed text.
- AC3: With JavaScript, a new Operator reply appears without reload and is announced to screen readers.
- AC4: The "messages don't change your booking" notice is always visible on the screen.
- AC5: Page and chat workspace render the same thread with the same text (parity).
- AC6: 320px reflow with no horizontal scroll; composer controls are 44px or more.

## Tests to add/update

New `test/guest-stay-messages.test.ts` and a Chromium test with `withStagePage`.

## ADR compliance

0060, 0067, 0075, 0078, 0080, 0094. Guest UI rules in `AGENTS.md`.
