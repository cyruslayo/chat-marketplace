# Save control and Favourites page with availability check

Status: ready-for-agent
Type: task
Blocked by: 04, 11
Requested: 2 Oct 2026

## Why

User stories 13 to 16: save from where the Guest finds an apartment, then come back, check dates and request.

## What to build

- **Save control.** A `.ui-icon-button` (44px, with an accessible name that says saved or not) on `.ui-stay-card` (`stayCardHtml` in `apps/local-guest/src/guest-kit.ts`) and on the unit page. A plain POST form so it works without JavaScript; with JavaScript it toggles in place. Chat and page render it from the same helper.
- **Favourites page** `GET /favourites` (signed-in, or per issue 01): saved apartments as `.ui-stay-card`s with live All-In Stay Total (ADR 0015 order: total first, deposit separate).
- **Availability check.** A date form (check-in, check-out) on the page. For each saved unit, the check uses the effective availability result (ADR 0039): `SqliteAvailabilityStore.findActive(unitId, start, end, now)` together with the publication and inspection gates the search already applies. The check never creates a block (ADR 0041: only a disclosed request blocks).
- **Outcomes per unit,** each with a `.ui-status` and wording from `guest-content.ts`: available (with "Request these dates"), unavailable for these dates, no longer listed, dates outside the 90-day horizon (ADR 0055), stay longer than 14 nights (ADR 0023), same-day or 3-hour rule (ADR 0053, 0054).
- **"Request these dates"** enters the existing Request Draft flow with the unit and dates filled in; it does not skip any step of that flow.
- No rating, "Verified" badge or price-pin map (ADR 0066 row of the guest UI PRD).

## Acceptance criteria

- AC1: Saving from the stay card and from the unit page adds the apartment to Favourites; unsaving removes it. Works without JavaScript.
- AC2: For free dates the unit shows as available and "Request these dates" opens the Request Draft with that unit and those dates.
- AC3: Each ineligible outcome (booked, blocked, unpublished, beyond 90 days, over 14 nights, too soon) shows its own status and no request action. One test per outcome.
- AC4: Running the check creates no availability commitment.
- AC5: Page and chat show the same favourites with the same text; 320px reflow; controls 44px or more.

## Tests to add/update

New `test/guest-favourites.test.ts` and a Chromium test with `withStagePage`; extend `test/guest-discovery-consistency.test.ts` for the save control on the stay card.

## ADR compliance

0015, 0023, 0039, 0041, 0053, 0054, 0055, 0066, 0078, 0080. Guest UI rules in `AGENTS.md`.
