# Saved Stay domain and store

Status: claimed
Type: task
Blocked by: 01, A-05
Requested: 2 Oct 2026

## Why

User stories 13 and 17: a Guest keeps apartments to come back to. The concierge's `AssistantTaskState.shortlist` (`apps/local-guest/src/assistant/assistant-state.ts:44`) is per-search and is replaced by each new search, so it is not this.

## What to build

- `domains/shortlet/src/saved-stay.ts`, exported from the index: `saveStay` and `removeStay` through `favourite.save` / `favourite.remove` command envelopes (ADR 0072), and `listSavedStays(accountGuestId, tenantId)`.
- Keyed by Guest Account. Signed-out saving is allowed (issue 01 answer 6): saves are keyed by the session principal and move to the account on sign-in through the Linked Principal (A-05); duplicates collapse.
- Cap of 100 per account (issue 01) as a constructor option; over the cap is refused with a reason.
- **Merge over the cap (recommended by the agent; the user asked for it to be built, 3 Oct 2026):** a sign-in merge never drops a save already in the account. The device's saves are added newest first until the cap; the rest are not kept and are returned to the caller as `skipped`, so the page can say so (e.g. "Your list is full: 3 apartments from this device weren't added"). The device principal ends with no saves.
- **Scope note:** A-05 (linked principals) is not built yet. This issue delivers the domain and stores keyed by an owner id (a Guest Account id or a session principal) plus `moveSavesToOwner`; A-05 calls it on sign-in.
- Stores the unit id and saved time only, not a copy of price or availability (prices and availability are always read live).
- In-memory and SQLite stores following `booking-state.ts`.

## Acceptance criteria

- AC1: Saving and removing a unit work and survive a restart; saving the same unit twice leaves one entry.
- AC2: Saving over the cap is refused and the list is unchanged.
- AC3: Saves made by a principal before sign-in appear in the account after sign-in, without duplicates.
- AC4: An account never sees another account's saves; a missing tenant fails closed.
- AC5: A sign-in merge that would exceed the cap keeps every account save, adds device saves newest first up to the cap, and reports the rest as skipped.

## Tests to add/update

New `test/saved-stay.test.ts`.

## ADR compliance

0004, 0070, 0072, 0092.
