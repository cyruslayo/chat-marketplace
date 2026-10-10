# "My stays" page

Status: ready-for-agent
Type: task
Blocked by: 03, A-06
Requested: 2 Oct 2026

## Why

The Guest's way back to a stay (user stories 1 to 3). It is also the entry point for review (06), messages (09) and, via the app bar, favourites (12).

## What to build

- `GET /stays/mine` (or a path agreed with the conventional routes from `guest-chat-first-ux` issue 06; check `/stays/*` is public today and keep this one signed-in only). Signed-out Guests go to `/account/sign-in?return=...`.
- Two sections, "Upcoming" and "Past" (cancelled bookings sit under Past with a "Cancelled" status; past stays without Verified Access show no review action) (labels from `apps/web-agent/src/guest-content.ts`). Each stay is a `.ui-ticket` from `apps/local-guest/src/guest-kit.ts` with: unit title, neighbourhood, dates with WAT times (ADR 0078), status (`.ui-status`), and actions that later issues fill in ("Leave a review", "Message the owner", "View booking").
- `GET /stays/mine/<reservation>` stay detail: the existing confirmation content for that booking, rendered by the same helper as the confirmation screen, plus the actions. Ownership is checked through the A-05 resolver; anything else is 404.
- Entry points: an app-bar link (`.ui-appbar`), and the concierge's committed-work reply (`committedWork`, `apps/local-guest/src/client.ts:2424`) links here.
- Empty state with `.ui-empty`: no stays yet, a link to search.
- No reviews or ratings shown anywhere (ADR 0066 row in `../guest-ui-consistency/PRD.md`).

## Acceptance criteria

- AC1: A signed-in Guest sees upcoming and past stays from all Linked Principals, grouped correctly. Failure path: signed out, the page redirects to sign-in and reveals nothing.
- AC2: Moving the clock past checkout moves a stay from Upcoming to Past on the next load.
- AC3: Opening a stay that belongs to another account returns 404.
- AC4: With no stays, the empty state shows with a link to search.
- AC5: Works without JavaScript; reflows at 320px; every action is 44px or more; dates show in WAT.
- AC6: Chat and page show the same stays with the same text (parity, ADR 0080).

## Tests to add/update

New `test/guest-my-stays.test.ts` and a Chromium test with `withStagePage`.

## ADR compliance

0066, 0070, 0078, 0080, 0092. Guest UI rules in `AGENTS.md`: kit components only, semantic tokens, copy from `guest-content.ts`, do not reformat `shortlet-foundations.css`.
