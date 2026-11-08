# 20 · Keep the guest's own facts across a clarification turn

Status: ready-for-agent
Type: task
Blocked by: 19
Requested: 8 Nov 2026

## Why

Found while finishing issue 19 (see its Comments and `test/assistant-partial-facts-across-turns.test.ts`, whose two restore cases are `test.todo`). On the assistant path, when the concierge has to ask for a missing fact, the turn is a clarification and, under ADR 0106, "commits no task state" (`apps/local-guest/src/assistant/assistant-runtime.ts` ~87). The assistant context is persisted only once it has a city (`apps/local-guest/src/shortlet-app.ts` ~3118–3119, synced ~3494), and a cold restore clears the conversation history (`assistant-runtime.ts` ~779). A warm process survives on that history; a cold restore (every staging request) does not:

| Turn 1 → turn 2 | Warm | Cold restore |
|---|---|---|
| "Ikoyi from 5 Jan for 3 nights" → "2 of us" | searches | asks for the dates again |
| "Ikoyi, 2 months from 5 Jan" → "2 of us" | searches 60 nights | asks for the dates again |

The landing chip flow ("Ikoyi, 2 months from 5 Jan, relocating", then the party size) hits this on staging.

## Owner decision (8 Nov 2026)

Narrow amendment to ADR 0106: a clarification turn still runs **no search, no tool effect, and keeps nothing the model proposed**, but it **saves the facts the guest's own words gave** into the existing persisted assistant context, so the next turn can use them after a cold restore. Ship together with issue 19.

## What to build

1. **Guest-authored facts only.** From the current guest text (and structured guest input), using the existing readers and authority rules: city/area (`resolveLocationMention` / the closed area list), check-in (the existing date-authority rules: ISO token, English day-month literal, or confirmed relative phrase; ADR 0106 "Structured dates"), stated length (issue 19's `statedStay`) and nights, party size, bedrooms. Nothing the planner or classifier proposed is saved on a clarification turn. A check-in that the date rules would refuse is not saved.
2. **Persist a partial context.** The existing assistant context projection may be saved with only some of these fields (no city required). No new fields beyond issue 19's `statedStay`; no new table (ADR 0093 minimal projection). A cold restore seeds the task state from it exactly as for a full context.
3. **Next turn.** The facts restored from a clarification turn are guest-authored, so the planner's search must use them (a planner search that contradicts a saved guest fact is a `tool_denial`, as for chip facts and the stated length). A new guest fact replaces the saved one; a chip edit replaces it too.
4. **Show-back.** The criteria strip after a clarification turn shows the saved facts (it already must come back on assistant responses, AGENTS.md).
5. **ADR 0106.** Add a dated line "Amendment (8 Nov 2026, issue 20)" stating the narrowed rule above. Change nothing else.
6. Turn the two `test.todo` cases in `test/assistant-partial-facts-across-turns.test.ts` into passing tests.

## Acceptance criteria

- AC1: Cold restore before every event: "Ikoyi from 5 Jan for 3 nights" then "2 of us" searches Ikoyi, 5–8 Jan, 2 guests.
- AC2: Cold restore before every event: "Ikoyi, 2 months from 5 Jan" then "2 of us" searches 60 nights, and the strip shows "60 nights (2 months)".
- AC3: A clarification turn saves nothing the planner proposed: a scripted planner that invents a check-in the guest never typed leaves no check-in in the saved context.
- AC4: A check-in the date rules refuse (e.g. "next month" without confirmation) is not saved.
- AC5: A new guest fact or a chip edit in turn 2 replaces the saved fact.
- AC6: The landing chip flow over the HTTP routes (landing handoff, demo off, cold restore between requests): "Ikoyi, 2 months from 5 Jan, relocating" then "2 guests" searches 60 nights.
- AC7: The persisted assistant context gains no field beyond issue 19's `statedStay` (assert its keys).
- AC8: The existing assistant tests (cold journey, criteria strip, date literals, scope controls, pending-action restore, persistent continuity, warm session) pass unchanged.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0106 | Date authority; guest-authored facts; `tool_denial`; cold restore; no keyword fast path; domain-neutral runtime; amended narrowly here |
| 0093 | Minimal persisted projection |
| 0092, 0023 | Stay lengths |

## Definition of Done

See `docs/agents/issue-tracker.md`. Record commands and pass counts in Comments.

## Comments

### Implementation (8 Nov 2026, commit ec16505, branch feat/month-phrasing)

Files: `apps/local-guest/src/assistant/shortlet-assistant-pack.ts` (`recordGuestAuthoredFacts`, `guestTypedCheckIn`, the
`recordGuestFacts` hook); `apps/local-guest/src/assistant/assistant-platform.ts` (the optional hook on the pack interface);
`apps/local-guest/src/assistant/assistant-runtime.ts` (the hook call after the scope check, for in-scope, non-mixed turns, on the
committed and the candidate state); `apps/local-guest/src/assistant/date-tokens.ts` (`mentionsCheckOut`);
`apps/local-guest/src/guest-projection.ts` (`city` optional; `isPartialAssistantContext`; the parser refuses any area-less context
that holds more than the guest's own fields); `apps/local-guest/src/shortlet-app.ts` (`#partialAssistantContext`; the context search
runs no search without an area and keeps the strip's criteria; the restore leaves `location` unset without an area);
`docs/adr/0106-enforce-concierge-agent-controls.md` (one dated line, "Amendment (8 Nov 2026, issue 20)", nothing else).
Tests: `test/assistant-clarification-facts.test.ts` (new: AC1 to AC5, AC7); `test/assistant-clarification-facts-http.test.ts` (new: AC6,
cold HTTP, one new handler per request, `/welcome/start` then `/api/turn`); `test/assistant-partial-facts-across-turns.test.ts` (the two
`test.todo` cold cases are now passing tests); `test/helpers/stay-length-fixtures.ts` (`storedAssistantContext`, `criteriaEditEvent`);
`test/stay-length-persisted.test.ts` (uses the shared `criteriaEditEvent`; no behaviour change); `test/stay-length-assistant.test.ts`
(one assertion, see Deviation below).

What is saved on a clarification turn (guest text only): the area (`resolveLocationMention`, only when the held city is the same or
absent); one day the guest typed (an ISO token or an English day-month literal, `guestDateLiterals`) that the booking horizon and the
stay rules accept, when the text names no checkout; a new check-in replaces the held dates and sets `isDemoDate` false; the checkout and
nights come only from the stated length (issue 19) with that check-in, by `validatedCheckOutForNights`; party size and bedrooms from
`extractStayRequestFacts`. The planner's and classifier's slots are never inputs.

### Commands and pass counts

- `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/assistant-clarification-facts.test.ts test/assistant-clarification-facts-http.test.ts`:
  7 pass, 0 fail (AC1, AC2, AC3, AC4, AC5, AC6, AC7).
- Before the implementation, the same three files: 9 of 11 failed (the seven new AC tests and the two cold partial-facts cases); the two warm
  cases passed.
- Affected set (20 files: the 2 new files, `test/assistant-partial-facts-across-turns.test.ts`, every `test/stay-length-*.test.ts`,
  assistant-cold-journey, assistant-date-literals, assistant-checkout-dates, assistant-scope-controls, assistant-pending-action-restore,
  assistant-persistent-continuity, assistant-runtime-boundary, assistant-pack-registry, assistant-location-change, assistant-budget-chip,
  guest-criteria-strip, warm-session-post-payment, landing-monthly-copy):
  `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test <20 files>`: 155 pass, 0 fail (exit 0).
  The first run had 2 fails (a same-date check-in in `assistant-scope-controls` "Date role AC2", fixed by `mentionsCheckOut`; and
  issue 19's AC3 nights assertion, see Deviation); the second run is the one recorded.
- Wider set (files that read the persisted context or the restore path, plus the restart and projection tests):
  `assistant-discovery-view`, `assistant-short-stays-29-nights`, `assistant-where-chip` and the `*restart*` and `*projection*` test
  files: 69 pass, 0 fail.
- `env -u LLM_API_KEY npm run check` on the committed tree (`ec16505`, clean except the untracked `node_modules` symlink): exit 0.
- Not run: the real-Chrome strip file (strip markup and `client.ts` are unchanged, so no `client.js` rebuild); the full `npm test` and
  `npm run test:workers` (the batch gate, CLAUDE.md).

### Acceptance criteria (named tests)

- AC1: `assistant-clarification-facts.test.ts`, "AC1 Cold restore before every event: ..." (5 Jan to 8 Jan, 2 guests; the strip reads
  "5–8 Jan 2027 · 3 nights", the stored context holds Old Ikoyi and 2 guests).
- AC2: same file, "AC2 ..." (the search ends 6 Mar 2027; the strip reads "... · 60 nights (2 months)").
- AC3: same file, "AC3 ..." (a planner check-in the guest never typed: `tool_denial` with the dated clarification, no search; the saved
  context has no check-in, checkout or nights, and keeps the guest's 60-nights length and Lagos).
- AC4: same file, "AC4 ..." ("next month", and an ISO date beyond the booking horizon: no check-in saved, no search).
- AC5: same file, "AC5 ..." (a new check-in replaces 5 Jan with 12 Jan; a criteria chip edit replaces it with 20 Jan).
- AC6: `assistant-clarification-facts-http.test.ts`, "AC6 ..." (the landing handoff to `/welcome/start`, then `/api/turn` "2 guests",
  each through a new handler: strip "60 nights (2 months)", stored checkout 2027-03-06).
- AC7: same file as AC1, "AC7 ..." (the persisted keys stay within issue 19's list, asserted after the clarification and after the search).
- AC8: no new test. The existing suites in the affected set pass (155 pass), with one assertion changed, see Deviation.

### Deviation from AC8 ("unchanged") — owner decision needed

`test/stay-length-assistant.test.ts`, issue 19 AC3 ("a planner call with 61 nights is a tool_denial"): the assertion
`persistedStay(...).nights === undefined` encoded the gap this issue closes. The guest's own words ("2 months from 5 Jan") now save the
60 nights with their check-in, so the test asserts `nights === 60` and `nights !== 61`. The 61-night call is still refused and no
61-night stay is recorded. Because AC8 says "unchanged", the status stays `ready-for-agent` until the owner accepts this one edit. If the
owner rejects it, the alternative is to save the check-in and the stated length only, without the derived nights; that also breaks the
show-back on a clarification turn (AC4 of the brief, item 4), so it is not implemented here.

### Decisions and gaps for the owner

- A text that names a checkout anywhere saves no check-in ("5 Jan to 8 Jan", "use 6 Nov for both the check-in and checkout dates").
  That is fail closed; a check-in paired with a checkout could be saved later as a separate decision.
- "2 of us" is not read by the deterministic reader (the existing `GUESTS_PATTERN`), so party size on that phrase comes from the
  planner on the next turn, as before. Not changed.
- AC6 says the assistant search reply shows "60 nights (2 months)". The assistant search reply carries no nights today (issue 19 note),
  so the months show on the criteria strip; the test checks the strip.
- ADR 0106 was amended with one line only; no other ADR or policy was changed. No new literal, no new persisted field, and no `any`.
- The map row for issue 20 is unchanged (`ready-for-agent`) pending the AC8 decision above.

### Status

Status stays `ready-for-agent`: AC1 to AC7 pass; AC8 passes with one owner-decision assertion change (see Deviation).
