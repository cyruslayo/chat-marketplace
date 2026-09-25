# Stop inventing dates; parse and confirm relative dates

Status: resolved
Type: task
Blocked by: 07
Findings: F2, F3 (see ../PRD.md)

## What to build

Replace the fixed `demoCheckIn` in `apps/local-guest/src/concierge.ts:316` with real date understanding. Handle explicit dates ("26 Sept", "26–28 Sept"), relative phrases ("tonight", "tomorrow", "this weekend", "next Friday") and nights plus a start date, all resolved against the injected clock. Every resolved range is shown back as concrete dates, and the guest confirms it before the search runs. Plain party phrases ("me and my wife", "just me", "a couple") set the guest count.

## Acceptance criteria

- AC1: No search runs with dates the guest did not give or confirm.
- AC2: "this weekend" resolves to the Friday–Sunday range after the injected clock, and the reply shows both dates.
- AC3: A range longer than 14 nights or beyond the 90-day horizon is refused with a plain explanation that states the limit.
- AC4: "me and my wife" sets 2 guests, and "just me" sets 1.
- AC5: If only the nights are known, the concierge asks for the start date instead of assuming one.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0023 | Stays are 14 nights or fewer |
| 0055 | Booking horizon is 90 days or less |
| 0031 | Arrivals fall in the bounded arrival window |
| 0054 | Same-day bookings are allowed without shortcuts |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- The deterministic path no longer uses `demoCheckIn`. `extractStayRequestFacts(text, { now })` resolves dates against the injected clock in Africa/Lagos time. The fixture setting remains only for the out-of-scope Gemini and assistant paths.
- Given vs confirmed (AC1): explicit calendar dates ("10 Sept", "26–28 Sept", "Sept 26", "from 26 Sept to 2 Oct") count as given. The search runs immediately and the reply states both dates ("from Thu 10 Sept 2026 to Sun 13 Sept 2026"). Relative phrases ("tonight", "today", "tomorrow", "this/next weekend", "Friday", "this/next Friday") return `kind: "confirm"` with concrete dates. Only a plain yes (`AFFIRMATION_PATTERN`) confirms them; new dates replace them. The context persists `checkIn` and `datesConfirmed`.
- Resolution rules: "this weekend" is the Friday on or after today through Sunday. "Next Friday" is Friday of the following Monday-start week. A bare weekday is the next occurrence on or after today. A day and month without a year is the next occurrence on or after today. Month-first parsing skips "May" so "may 2 people…" is not read as a date.
- AC2: On the Thursday fixture clock, "this weekend" resolves to 4–6 Sept. On a Saturday clock it resolves to 11–13 Sept. The reply shows both dates.
- AC3: `MAX_STAY_NIGHTS` and `BOOKING_HORIZON_DAYS` are now exported from `domains/shortlet/src/browse.ts` (ADR-0023, ADR-0055), along with `dateKeyInLagos`, so no limit is duplicated. Refusals state the limit, and the horizon refusal names the latest arrival date. The horizon applies to check-in only (ADR-0055). 14 nights and day 90 are accepted.
- AC4: "just me", "only me", "by myself" and "solo" mean 1 guest. "Me and my wife/husband/partner…", "my wife and I", "a couple" and "the two of us" mean 2. An explicit count always wins.
- AC5: If only the nights are known, the concierge asks "what date you arrive (for example: 10 Sept or this Friday)" and never assumes a date.
- ADR-0031 and ADR-0054: the concierge only resolves "tonight" or "today" to today's date and confirms it. Same-day bookability and the 2:00 PM–10:00 PM arrival window stay with the authoritative search and check-in domain. The concierge adds no cutoff rule and makes no promise about arrival time.
- Tests: `test/guest-real-dates.test.ts` has one test per AC. Existing date-less test prompts now carry an explicit date that matches each fixture's former demo check-in: "from 10 Sept" on the local fixture, "from 29 Sept" on the local pilot, and a live-clock date a week ahead for production composition. The Gemini and assistant test prompts are unchanged.
- Verification: `npm run check` passed. `npm test`: 1,098 passed, 1 failed, 1 skipped. The failure was the known flaky `listing-photos-mobile-chromium` photo wait (320px), which passes when run alone. Walkthrough at 375px and 1280px on :3004 covered the nights-only question, "me and my wife" as 2 guests, "this weekend" confirmed with "yes" and searched, the 20-night refusal, the "20 Dec" horizon refusal naming Wed 2 Dec 2026, and "26–28 Sept" searched directly. No overflow and no console errors.
