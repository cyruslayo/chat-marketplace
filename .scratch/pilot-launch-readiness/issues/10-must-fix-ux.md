# Fix must-fix guest and back-office UX

Status: resolved
Type: task
Blocked by: none

## What to build

Agent-led discovery in the web app is the product's core experience (issue 11), so it must feel trustworthy to a real guest. Fix the items that would embarrass a real guest or slow the operator down. Check the current state first; some may already be fixed.

## Acceptance criteria

- [x] The concierge never invents check-in dates (finding F2; `.scratch/guest-chat-first-ux/issues/01-confirm-real-dates.md`).
- [x] The concierge understands everyday requests such as "this weekend", "me and my wife" and "show me the apartment", or asks rather than ignoring them (findings F3 and C4; guest-chat-first-ux issue 02).
- [x] The guest can see what the agent understood (city, dates, guests, budget) and change it (finding F1; guest-chat-first-ux issues 03a and 03b).
- [x] Booking request status and confirmation screens show the apartment title, not the unit id (pilot acceptance findings C1 and C2).
- [x] The back office shows apartment and owner names, not raw ids (C3).
- [x] Conventional search and booking pages work where chat fails (F9; guest-chat-first-ux issues 06a and 06b).

## Answer

Branch `ux/issue-10-must-fix` (stacked on `launch/guardrails-and-notifications`, which now includes main with the guest gallery).

Audit (28 Sept 2026), criterion by criterion:
- **Never invents dates (F2):** already met on main (guest-chat-first-ux 01; `test/guest-real-dates.test.ts`).
- **Everyday requests (F3, C4):** "this weekend" and "me and my wife" were already met (guest-chat-first-ux 02). "Show me the apartment" was **not** met: it got the canned "results are still active" reply. Fixed here: `viewResultIntent` in `concierge.ts` plus `#viewResultFromChat` and `#openUnitDetail` in `guest-server.ts`. The concierge opens the chosen result, or asks which one with quick replies. Verified in a real browser: it asked, and "The first one" opened the Old Ikoyi details panel.
- **See and change what was understood (F1):** already met (guest-chat-first-ux 03a/03b, criteria strip).
- **Titles on status and confirmation (C1, C2):** already fixed on main, but untested. A production journey probe showed "Luxury 2-Bedroom Apartment in Old Ikoyi" on both screens. Now locked in by a test.
- **Back-office names (C3):** already met (back-office B1 AC1). Now also asserted on the journey's inbox, request and home pages.
- **Conventional pages where chat fails (F9):** already met (guest-chat-first-ux 06a/06b). Now asserted with the AI concierge failing.

Tests: `test/guest-must-fix-ux.test.ts`, one per criterion. The journey test freezes the clock inside Operator Active Hours (ADR 0042); with a live clock it would fail after 7:30 PM WAT.
