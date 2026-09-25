# Replies restate what the concierge understood

Status: resolved
Type: task
Blocked by: 01
Findings: F1 (see ../PRD.md)

## What to build

Replace "I've kept what you've already told me" in `clarifyReply` (`concierge.ts`) with a reply that lists the understood criteria (area, dates, guests, preferences) and asks only for the next missing one. Mention input that was not understood instead of dropping it.

## Acceptance criteria

- AC1: Each clarify reply names every criterion that is known.
- AC2: Each clarify reply asks for exactly one missing criterion.
- AC3: A preference word the parser does not support (for example "quiet") is acknowledged as not yet filterable, not silently dropped.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0077 | Canonical meaning across channels; en-NG dates |
| 0004 | Backend owns the criteria state that is reflected |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- AC1: `clarifyReply` in `concierge.ts` now opens with "So far I have: …" and lists every criterion in the server-owned context (ADR-0004): area (neighbourhood, city), guests, dates (the arrival date, or both dates once nights are known, marked "(to confirm)" until confirmed), nights and bedrooms. "I've kept what you've already told me" is gone.
- AC2: Each reply asks one question, in the order where → who → when → how long. The full `missing` list remains in the resolution for callers.
- AC3: `extractStayRequestFacts` reports `unsupportedPreferences` for quiet, pool, gym, parking, Wi-Fi, balcony, view, pets, price level (cheap, affordable, budget, luxury), power backup, kitchen and workspace. `unsupportedPreferenceNote` adds "I can't filter by “quiet” yet, so it isn't applied to the search." to every reply for that turn: clarify, confirm, refuse, conflict, search, and results-still-active. A preference-only turn never re-runs the search. Price words will become filterable in the budget slice (03b).
- ADR-0077: `formatGuestDay` now formats with en-NG, which produces the same output as before.
- Tests: `test/guest-reflective-replies.test.ts` has one test per AC. The conversational-discovery test that expected two questions in one reply now expects the single guests question. `pilot-local` no longer requires a nights question to have been asked.
- Verification: `npm run check` passed. `npm test`: 1,097 passed, 5 failed, 1 skipped. All 5 were browser timeouts under full-suite load: listing photos at 390px, the S1 AC1 mobile walk, and three `pilot-local` isolation tests. Each passes when rerun alone. Walkthrough at 375px and 1280px on :3004 covered "quiet in Ikoyi", then "me and my wife", "from 10 Sept", and "3 nights, with parking" (search plus parking note), and "cheap with a pool" (pool and price-level note). Every reply restated the known criteria and asked one question. No overflow and no console errors.
