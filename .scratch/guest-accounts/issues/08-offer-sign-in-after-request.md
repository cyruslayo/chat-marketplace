# Offer sign-in after a request and on confirmation

Status: ready-for-agent
Type: task
Blocked by: 06
Requested: 2 Oct 2026

## Why

Most Guests will arrive anonymous and book before thinking about an account. The moments when keeping their work matters most are just after sending a request and just after a booking is confirmed (user story 9). This must stay an offer, never a gate (ADR 0085).

## What to build

- On the "request sent" screen and the confirmation screen (page and chat workspace, from the same helper as required by the guest UI kit rule), an anonymous Guest sees a `.ui-panel` with copy like "Keep this booking on all your devices" (final copy in `guest-content.ts`, agreed with the user) and a "Send me a code" action.
- The email is pre-filled from the contact already given (`SqliteGuestContactRepository`), editable.
- Signed-in Guests do not see the panel.
- The concierge mentions it once after these moments, with a link to the page form (no sign-in inside the chat model's tools; ADR 0072 keeps consequential actions as platform commands).
- No change to request, offer or payment eligibility.

## Acceptance criteria

- AC1: An anonymous Guest sees the offer on the request-sent and confirmation screens, in both the page and the chat workspace, with the same text. Parity test.
- AC2: Completing the code step from that panel returns to the same screen, now signed in, and the panel is gone.
- AC3: A signed-in Guest never sees the panel.
- AC4: Declining or ignoring the offer changes nothing in the booking flow (existing booking and payment tests stay green).

## Tests to add/update

Extend the request-sent and confirmation tests (`capture-07.ts` / `capture-10.ts` screen groups) and add a parity test.

## ADR compliance

0072, 0078, 0080, 0085, 0093. Guest UI rules in `AGENTS.md`.
