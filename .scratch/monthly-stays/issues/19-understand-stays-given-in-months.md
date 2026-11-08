# 19 · Understand stays given in months (and weeks)

Status: resolved
Type: task
Blocked by: none
Requested: 8 Nov 2026

## Why

Extended Stays are marketed as 1 to 6 months, but the concierge only reads a stay length typed as "<n> nights" (`NIGHTS_PATTERN` in `apps/local-guest/src/concierge.ts`, used by `extractStayRequestFacts`). On the assistant path the model fills `nights` itself with no check against the guest's words, so "2 months" can become 60 nights, 61 nights or a "how many nights?" question depending on the turn. That is why the landing chip had to say "60 nights".

## Owner decisions (8 Nov 2026)

1. **A month is 30 nights**: N months = 30 × N nights (ADR 0092 as amended 1 Nov 2026: "a month is one 30-night Billing Period"). Take 30 from the Extended Stay policy's `billingPeriodNights`, never a new literal.
2. **Show-back**: when the guest gave the length in months, show the nights first and their words in brackets, e.g. "Tue 5 Jan to Sat 6 Mar 2027 · 60 nights (2 months)". Weeks and nights show nights only.
3. **Landing chip** goes back to months: "Ikoyi, 2 months from 5 Jan, relocating" (nights 60), replacing "Ikoyi, 60 nights from 5 Jan, relocating".

## What to build

1. **One shared stay-length reader** in the shortlet domain (beside `domains/shortlet/src/stay-date-phrases.ts`, exported from the domain index; reuse its `NUMBER_WORDS` and `DAYS_PER_WEEK`). Closed list of phrases, digits and number words:
   - "N nights" (as today), "a/one night";
   - "a/one week", "N weeks" → 7 × N; "a fortnight" → 14;
   - "a/one month", "N months" (1 to 12 as words or digits) → `billingPeriodNights` × N.
   Ambiguous or vague lengths ("a few months", "2-3 months", "2 or 3 months", "a couple of months", "a month or two", "a month and a half") give **no** length, so the concierge asks, exactly as when no length is given. Two different lengths in one message also give no length. A check-out date still wins over any duration (existing rule). Lengths outside the stay rules (e.g. "7 months" = 210 nights, or 15–29 is now fine) go through the existing validation and refusals unchanged.
2. **Deterministic path and shell.** `extractStayRequestFacts` uses the reader (keep `NIGHTS_PATTERN` behaviour as a subset). It also returns the phrase's unit and count so the show-back can say "(2 months)".
3. **Assistant path: the guest's stated length is authoritative.** A length the guest typed (current or earlier guest text) is a guest-authored stay fact, like chip nights (ADR 0106 "Chip facts"): record it in the task state and the runtime facts the planner sees. A planner `search_stays` or `prepare_request_draft` whose `nights` differ from the guest-authored length is a rejected tool call (`tool_denial`, never `CONCIERGE_UNAVAILABLE`), and the reply shows back the guest's length. The runtime stays domain-neutral: the reading lives in the shortlet pack/shell, not in `assistant-runtime.ts`. No keyword fast path around the classifier or planner: the turn still goes through them.
4. **Show-back** in the concierge reply and the criteria strip, per decision 2. The criteria chip value stays the number of nights.
5. **Landing chip** per decision 3 (within the 45-character chip limit; nights 60).
6. **ADR 0106**: add a dated amendment line under "Chip facts": a stay length the guest typed (nights, weeks, months) is a guest-authored stay fact; a month is 30 nights (ADR 0092).

## Acceptance criteria

- AC1: The reader maps "for 2 months", "two months", "a month", "1 month", "3 weeks", "a fortnight", "a week" and "21 nights" to 60, 60, 30, 30, 21, 14, 7 and 21 nights; "a few months", "2-3 months", "2 or 3 months", "a couple of months", "a month and a half" and "2 months, 45 nights" give no length.
- AC2: On the deterministic path, "Ikoyi, 2 months from 5 Jan, 2 guests" searches 60 nights (5 Jan to 6 Mar 2027) and the reply shows "60 nights (2 months)".
- AC3: On the assistant path (enabled, cold restore before every event, clock 2026-10-27, staging-like guest), "Ikoyi for 2 months from 5 Jan, 2 of us" yields a 60-night search; a planner call with 61 nights is a `tool_denial` and no 61-night search runs.
- AC4: A vague length ("a few months") gets the nights question on both paths, never a guessed length.
- AC5: "7 months" is refused with the existing 180-night message on both paths.
- AC6: The landing chip "Ikoyi, 2 months from 5 Jan, relocating" sent through the landing handoff (demo off) yields a 60-night search with the "(2 months)" show-back.
- AC7: The criteria strip after a months request shows 60 nights and its edit chip keeps working (chip edits still override, ADR 0106).
- AC8: Existing nights-only behaviour is unchanged (the existing concierge, criteria-strip and landing tests pass).

## ADR compliance

| ADR | Constraint |
|---|---|
| 0092 (amended 1 Nov 2026) | A month is one 30-night Billing Period; 30–180-night Extended Stays |
| 0023 (amended) | 1–29-night Short Stays |
| 0106 | Guest-authored facts; `tool_denial`; cold restore; no keyword fast path; domain-neutral runtime |
| 0077 | One source for guest wording |

## Definition of Done

See `docs/agents/issue-tracker.md`. Record commands and pass counts in Comments. New guest wording: only "(N months)" / "(1 month)" in the show-back; list it in Comments.

## Comments

### Implementation (branch feat/month-phrasing, commit b095938)

Files: `domains/shortlet/src/stay-length.ts` (new reader, exported from `domains/shortlet/src/index.ts`);
`domains/shortlet/src/stay-date-phrases.ts` (exports `NUMBER_WORDS` and `DAYS_PER_WEEK`, unchanged values);
`apps/local-guest/src/concierge.ts` (`extractStayRequestFacts` reads the reader; `StatedStayLength` on the context and the facts;
the search reply and the strip keep it; `NIGHTS_PATTERN` removed); `apps/local-guest/src/shortlet-app.ts` (search reply suffix,
criteria strip label); `apps/local-guest/src/assistant/shortlet-assistant-pack.ts` (`guestStatedStay`, `guestStatedNights`, the
`search_stays` and `prepare_request_draft` checks, and the no-operation reply fallback); `apps/web-agent/src/guest-content.ts`;
`apps/local-guest/src/landing-copy.ts` (chip only); `apps/local-guest/dist/client.js` (regenerated: `client.ts` bundles `guest-content.ts`);
`docs/adr/0106-enforce-concierge-agent-controls.md` (one dated line under "Chip facts", 8 Nov 2026).
Tests: `test/stay-length-reader.test.ts` (new), `test/stay-length-months.test.ts` (new), `test/stay-length-assistant.test.ts` (new),
`test/helpers/stay-length-fixtures.ts` (new shared helper), `test/landing-monthly-copy.test.ts` (AC4 handoff adapted to the new chip,
renamed to carry issue 19 AC6), `test/landing-chip-limit.test.ts` (the approved-chip list).

### Commands and pass counts

- `env -u LLM_API_KEY npm run check` (committed tree and before commit): exit 0.
- `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/stay-length-reader.test.ts`: 5 pass, 0 fail.
- Affected set (29 files: the three new files, every file importing `concierge.ts` or `stay-date-phrases.ts`, and the required
  list: assistant-short-stays-29-nights, assistant-date-literals, assistant-cold-journey, assistant-scope-controls,
  assistant-pack-registry, assistant-runtime-boundary, guest-criteria-strip, guest-discovery-reasons, guest-draft-revision,
  landing-monthly-copy, landing-page, landing-chip-limit, landing-handoff, domain-boundary, short-stay-29-nights, continuous-occupancy):
  `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test <29 files>`: 255 tests, 255 pass, 0 fail.
  (`guest-discovery-reasons`, `landing-handoff` and `domain-boundary` are in the list; their pass counts are inside the 255.)
- `env -u LLM_API_KEY npm run build`: exit 0; only `apps/local-guest/dist/client.js` changed (+7/-1, the copy above).
- Real Chrome, once, under the browser lock with `SHORTLET_CHROME_PATH=/usr/bin/google-chrome`:
  `flock .../browser.lock ... npx tsx --test test/guest-criteria-strip-chromium.test.ts`: 2 pass, 0 fail (the strip label changed).
- Full `npm test` and `npm run test:workers` were NOT run here: CLAUDE.md runs them once per batch before the merge to main.

### Acceptance criteria (named tests)

- AC1: `stay-length-reader.test.ts`, "AC1 the reader maps ..." (60, 60, 30, 30, 21, 14, 7, 21) and "AC1 'a few months' ... give no length"
  (all six vague phrases give `vague`, so no length), plus "AC1 a length in months is a closed reading ..." and "AC1 an 'in N weeks' check-in phrase ...".
- AC2: `stay-length-months.test.ts`, "AC2 On the deterministic path ...": search 5 Jan to 6 Mar 2027, reply "60 nights (2 months)".
- AC3: `stay-length-assistant.test.ts`, "AC3 'Ikoyi for 2 months ...' yields a 60-night search ..." (cold restore before the event; persisted nights 60,
  checkout 2027-03-06) and "AC3 a planner call with 61 nights is a tool_denial ..." (`search_stays` rejected, reply "60 nights (2 months)",
  no 61-night stay recorded).
- AC4: `stay-length-months.test.ts` ("AC4 ... on the deterministic path") and `stay-length-assistant.test.ts` ("AC4 ... on the assistant path"):
  the nights question, no search; the planner's guessed 60 nights is rejected.
- AC5: `stay-length-months.test.ts` ("AC5 ... deterministic path") and `stay-length-assistant.test.ts` ("AC5 ... assistant path"):
  reply "Stays can be at most 180 nights. Please choose 180 nights or fewer."; no search.
- AC6: `landing-monthly-copy.test.ts` ("AC4 (and issue 19 AC6) ..."): the handoff page shows "60 nights (2 months)". `stay-length-months.test.ts`
  ("AC6 ..."): the chip, then "2 guests", searches 60 nights with the show-back. See the decision on the chip below.
- AC7: `stay-length-months.test.ts`, "AC7 The criteria strip after a months request ...": "60 nights (2 months)", then the chip edit to 3 nights
  overrides it and the label has no months.
- AC8: `stay-length-months.test.ts`, "AC8 Existing nights-only behaviour is unchanged ...", plus the existing concierge, criteria-strip and landing suites in the 255.
- Guard (not an AC): `stay-length-reader.test.ts`, "Guard for AC8: a money rate such as ..." (found while running the budget suite).

### New guest wording (the list the brief asks for)

1. "(N months)" and "(1 month)": `guestStayMonthsWords` in `apps/web-agent/src/guest-content.ts`, the only source.
2. Show-back sentences that use it: the deterministic show-back ("arriving X and leaving Y, 60 nights (2 months), G guests in P"),
   the search reply ("... to Sat 6 Mar 2027, 60 nights (2 months)."), the criteria strip ("... · 60 nights (2 months)") and the clarify line.
3. One further sentence, a show-back of the stated length, for a rejected planner call: `GUEST_ASSISTANT_COPY.statedStay`
   = "Just to check: 60 nights (2 months). Which length should I search?". It is a show-back with the same words, but it is a second
   new sentence. The owner should confirm it or name the wording to use.

### Decisions taken conservatively

- Vague or conflicting lengths give no length: ranges ("2-3", "2 to 3"), "or"/"and" phrases ("2 or 3", "a month or two",
  "a month and a half"), "a few", "a couple of", two different lengths. "in N weeks" / "in N months" are check-in phrases, so no length.
- Only 1 to 12 months are read ("13 months" is vague and asks the nights). Weeks take up to two digits. Nights keep the old
  aliases ("nts", "nitesc").
- A money rate is not a length: "a/an/one" directly after an amount ("₦70,000 a night", "₦300,000 a month", "70k a night").
- Weeks and fortnights show nights only in the show-back. Only months are bracketed.
- A check-out date still wins over any duration (deterministic and assistant). The assistant skips the length check on those turns.
- Assistant authority is derived each turn from the canonical guest text (`userTextHistory`), not written to the task state.
  Reason: ADR 0106 (27 Oct 2026, Projection) allows no new persisted record, and a cold restore rebuilds the same authority from the
  canonical history. This departs from the brief's wording "record it in the task state and the runtime facts"; the runtime facts are
  unchanged. Owner decision if the planner must see the length as a fact.
- Authority order: the current turn's length wins. With none this turn, an earlier guest length counts only while the task still holds
  the nights it set, so a chip or other edit that changed the nights since then wins (ADR 0106 chip facts; AC7).
- A vague length in the current turn lets the planner repeat only the nights the task already holds; any other nights get the nights question.
- The planner's 7-month call is rejected by the tool schema (nights at most the policy maximum), before any application operation.
  The reply is then the no-operation fallback, which uses the existing limit sentence. That fallback reads the deployment default
  `EXTENDED_STAY_POLICY` (no environment in scope there). Every composition supplies that policy (`local-owner-environment.ts`).
- The `search_stays` reply on the assistant path shows no nights today, so no months show-back was added there.

### Gaps and conflicts for the owner

- AC6, as written, says the chip "yields a 60-night search". The chip names no party size, and a search needs one
  (`resolveStayRequestContext` asks "how many guests", `apps/local-guest/src/concierge.ts`). So the chip alone shows "So far I have:
  ... 60 nights (2 months)" and asks for the guests. The test checks that, then "2 guests" gives the 60-night search. Owner decision: keep
  the chip wording and accept the question, or add a party to the chip (its text is owner-approved).
- The deterministic guest vocabulary does not read "2 of us" (`GUESTS_PATTERN` takes "guests", "people", "adults", "pax"...). This is
  existing behaviour, not changed here.
- No new `any`; no new literal 30 (the month length comes from `EXTENDED_STAY_POLICY.billingPeriodNights`). `MAX_STATED_MONTHS = 12` is the
  issue's "1 to 12" range.
- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts:929` has a pre-existing `any` (not touched).

### Definition of Done (issue-tracker.md)

1. Each AC has named tests mirroring its text (see the list above); no test covers two ACs.
2. Failure paths: AC1 negatives; AC3 tool_denial and no 61-night stay; AC4 and AC5 assert no search runs.
3. ADRs read and cited: 0106 (full), 0092 (30-night month, 30 to 180), 0023 (1 to 29 nights), 0077 (one copy source), 0055 (horizon, via the 90-day check).
4. No unused injected dependency: `readStayLength` takes `policy` and uses `billingPeriodNights`; `guestStatedNights` uses `policy`.
5. No invented policy: months 1 to 12 is the issue's range; the rest is ADR-sourced.
6. No credentials or identity in logs: no logging added.
7. `npm run check` passes (exit 0). The full `npm test` runs at the batch pre-merge gate (CLAUDE.md), not here.

### Follow-up (8 Nov 2026): owner wording and two corrections

- Denial sentence (owner decision, 8 Nov 2026). `GUEST_ASSISTANT_COPY.statedStay` (`apps/web-agent/src/guest-content.ts`) now reads
  "Just to check: you’d like 60 nights (2 months). Shall I search for that?" (typographic apostrophe). A weeks or nights length reads
  "Just to check: you’d like 21 nights. Shall I search for that?". This replaces the sentence in "New guest wording" item 3 above.
  Still one source. Tests: `test/stay-length-assistant.test.ts`, "AC3 a planner call with 61 nights ..." asserts the exact sentence.
  Requested tests for this change: `npx tsx --test test/stay-length-reader.test.ts test/stay-length-months.test.ts
  test/stay-length-assistant.test.ts test/assistant-runtime-boundary.test.ts test/assistant-pack-registry.test.ts
  test/assistant-cold-journey.test.ts test/guest-criteria-strip.test.ts`: 32 tests, 32 pass, 0 fail.
  `apps/local-guest/dist/client.js` regenerated (`npm run build`: exit 0; +2/-1, the new sentence only).
- Correction to the earlier claim. The Comments above said an earlier guest length is "re-derived from the canonical history" and
  "carries earlier words across a cold restore". That is wrong. `userTextHistory` is the canonical ISO dates plus the current turn only
  (`apps/local-guest/src/assistant/assistant-runtime.ts:1157`). `canonicalUserFactHistory` is filtered to ISO dates
  (assistant-runtime.ts:778 and 817), and `restoreShortletState` clears `conversationHistory`, so earlier guest words do not survive a
  cold restore. The earlier-length branch of `guestStatedStay` (`shortlet-assistant-pack.ts`) therefore never fires in practice. The
  pack comment is corrected to say so. Only a length stated in the current turn is authoritative.
- Assistant-path criteria strip: NOT DONE, blocked. Requested: on assistant responses and getState, the strip shows "60 nights (2 months)"
  when the guest's latest stated length (re-derived from canonical guest text) is in months and equals the strip's nights. That
  re-derivation is impossible under the no-new-persisted-record rule (ADR 0106, 27 Oct 2026, Projection): the words are not kept
  across a cold restore (see the correction above). The two requested strip tests were not written, since they cannot pass as specified.
  Owner decision needed: (a) keep the stated length in the task state or canonical facts (a new persisted field, which needs an ADR
  amendment), or (b) keep the strip on nights only on the assistant path, with months shown only on the deterministic path.

### Follow-up (8 Nov 2026, owner decision): the stated length is persisted with the conversation

Decision (owner, 8 Nov 2026): the guest's stated stay length is kept as `stayIntent.statedStay` (`AssistantStatedStay`: `nights`, `unit` night | week | month, `count`) and persisted as `assistantContext.statedStay` (ADR 0106 Projection, amended 8 Nov 2026). No other field and no new record.

- Set: a length typed in a turn (`recordGuestStatedStay`, run at each turn start from the pack's `settlePendingGuestFacts`); a nights chip edit (unit night); a check-out the guest gave (the search commit, and a confirmed checkout show-back, unit night).
- Replaced by a new typed length, a nights chip edit or a checkout. A vague length keeps it. A fortnight is kept as two weeks (the owner's closed unit set has no fortnight).
- Authority: `guestStatedStay(userTextHistory, statedStay)`. The current turn's length or its vagueness decides first; otherwise the persisted length binds `search_stays` and `prepare_request_draft`. A different nights value is a `tool_denial` with `GUEST_ASSISTANT_COPY.statedStay` (wording unchanged). The earlier-length branch that never fired after a cold restore is removed.
- Restore: `#assistantContextFromState` writes it, `#restoreShortletState` restores it onto the stay intent, and `parseStatedStay` (guest-projection.ts) refuses a malformed value (the context is refused, nothing is guessed).
- Strip and reply: `stayNightsLabel` (concierge.ts) is the one helper for the deterministic show-back, the criteria summary and the criteria strip ("60 nights (2 months)" only when the length is in months and its nights equal the nights shown). On the assistant path the strip gets the length from the persisted context (`statedStayLengthPart`, shortlet-app.ts) only while its nights equal the held nights.
- Runtime: `recordGuestStay` copies `statedStay` as an opaque stay fact, with the nights it sets (assistant-runtime.ts); the runtime does not read it.

Files: `apps/local-guest/src/assistant/assistant-state.ts` (type, field); `apps/local-guest/src/assistant/shortlet-assistant-pack.ts` (`guestStatedStay`, `statedStayOf`, `recordGuestStatedStay`, the settle, search-commit and hook edits); `apps/local-guest/src/assistant/assistant-runtime.ts` (`recordGuestStay`); `apps/local-guest/src/guest-projection.ts` (`PersistedStatedStay`, `parseStatedStay`); `apps/local-guest/src/shortlet-app.ts` (persist, restore, strip, chip facts); `apps/local-guest/src/concierge.ts` (`stayNightsLabel`); `docs/adr/0106-enforce-concierge-agent-controls.md` (one dated line under Projection, 8 Nov 2026, issue 19). No client.ts change, so `apps/local-guest/dist/client.js` is not rebuilt.

Tests: `test/stay-length-persisted.test.ts` (new, five tests with the owner's names; reuses `test/helpers/guest-date-fixtures.ts`: assistant enabled, clock 2026-10-27, staging-like guest, a new `LocalGuestApp` over the same store before every event). Before the change: 0 pass, 5 fail (no `statedStay`; the strip without the months).

Commands and counts:
- `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/stay-length-persisted.test.ts`: 5 pass, 0 fail (after the change).
- Affected set (16 owner files: stay-length-*, guest-criteria-strip, assistant-cold-journey, assistant-pending-action-restore, assistant-persistent-continuity, assistant-runtime-boundary, assistant-pack-registry, assistant-scope-controls, landing-monthly-copy, warm-session-post-payment, plus assistant-checkout-dates, assistant-short-stays-29-nights, assistant-budget-chip, assistant-location-change, assistant-date-literals; 18 files with the new one): 153 pass, 0 fail.
- Widened set (the 73 test files importing the changed modules, plus the new file): 667 tests, 665 pass, 2 fail. The two are `test/commerce-surfaces-chromium.test.ts` real-Chromium tests ("renders visible discovery, cart and order facts" and "renders the proposed checkout ..."), which fail with commerce off; both are on the accepted-failure list in AGENTS.md.
- `env -u LLM_API_KEY npm run check`: exit 0.
- Not run: `test/guest-criteria-strip-chromium.test.ts` (the rule runs it only when the strip markup changes; the markup and the deterministic label text are unchanged). Not run: full `npm test` and `npm run test:workers` (the batch pre-merge gate).

Gaps for the owner:
1. A months-only first turn is not persisted. A clarification turn commits no task state (ADR 0106 `tool_denial`, assistant-runtime.ts:87), and the persisted context needs a city and a check-in. In a scripted reproduction, "Ikoyi for 2 months from 5 Jan" then "2 of us" persisted no assistant context, and the second turn asked for the dates instead of searching. So the new tests carry the party in the first turn. The two-turn example in the brief needs a decision on whether a clarification turn may persist location and check-in (this changes the `tool_denial` rule). Until then, a months-only first turn binds only while the process stays warm.
2. The check-out rule (a check-out the guest gave sets unit night) is implemented but has no dedicated test. The phrasings I tried ("Ikoyi 5 Jan to 6 Mar for 2 guests", "check-in ... and checkout ...") were refused by the existing date rules before reaching it.
3. The pre-existing `any` at `apps/local-guest/src/assistant/shortlet-assistant-pack.ts:943` (`results.map((unit: any, ...)`) is untouched.

### Follow-up (8 Nov 2026): partial facts across two turns (gap 1 checked)

Test: `test/assistant-partial-facts-across-turns.test.ts` (new). Turn 1 gives the place, the date and the length with no party (the planner asks); turn 2 gives "2 of us" and the planner searches with the facts from both turns.
- (a) "Ikoyi from 5 Jan for 3 nights" then "2 of us": warm PASS; cold FAIL ("I need your check-in and checkout dates").
- (b) "Ikoyi, 2 months from 5 Jan" then "2 of us": warm PASS (60 nights); cold FAIL (same reply).

Cause (pre-existing, not issue 19's): a clarification turn leaves no city or check-in in the runtime state. After turn 1 the runtime holds only `statedStay` (checked directly). The assistant context is persisted only with a city (`apps/local-guest/src/shortlet-app.ts:3118-3119`, synced at `:3494`), so nothing is stored. `restoreShortletState` also clears the conversation history (`apps/local-guest/src/assistant/assistant-runtime.ts:779`), which is where the planner's check-in text was held in the warm run. In (b) the stated length is in the same position, so it is lost with the check-in. Fixing this means persisting a clarification turn's location and check-in, which changes the ADR 0106 `tool_denial` rule: an owner decision, not made here.

The two cold cases are marked `todo` in the file with this reason. Counts: `test/assistant-partial-facts-across-turns.test.ts`, `test/stay-length-persisted.test.ts`, `test/assistant-cold-journey.test.ts`: 13 tests, 11 pass, 0 fail, 2 todo; `npm run check`: exit 0.
