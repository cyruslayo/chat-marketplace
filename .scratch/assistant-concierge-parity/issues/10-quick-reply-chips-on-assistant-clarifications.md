# Assistant: ask for missing criteria in order, with quick-reply chips

Status: resolved
Type: AFK
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

The deterministic path asks where, who, when, then nights, one at a time, with `quickRepliesFor` chips (issue 11 AC3, `concierge.ts:130`, `shortlet-app.ts:1055`). The assistant's clarifications are fixed sentences (`GUEST_ASSISTANT_COPY.stayClarification`, `safeClarification`) with no chips, and `quickReplies` never appears in `apps/local-guest/src/assistant/`.

## What to build

- When the assistant clarifies (a `clarify_stay` reply plan or a stay-details `tool_denial`), the pack names the next missing criterion from the task state and the result carries `quickRepliesFor(next)`.
- The "when" chips must not offer relative dates until issue 04 lands; until then offer the date chip.

## Acceptance criteria

- [x] AC1: "Apartment for 2" with no area offers the area chips.
- [x] AC2: With area and guests known, the reply asks for dates and offers the date choice. (The date choice is the plain-word dates sentence; no `when` chips, see deviations.)
- [x] AC3: Tapping a chip fills that criterion in the assistant task state.
- [x] AC4 failure path: no chips appear on an out-of-scope or support reply.
- [x] AC5: Chips meet the 44px target (ADR 0078) in the chat workspace at 320 and 1280.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0078 | 44px targets | AC5 |
| 0106 | Chip input is structured guest input | AC3 |
| 0080 | Parity | AC1, AC2 |

## Comments

### Implementation ADR table (agent, 2 Nov 2026)

| ADR | Constraint | Code path / AC |
|---|---|---|
| 0099 | The runtime stays domain-neutral: one optional pack hook `clarificationQuickReplies` returns chips; the shortlet pack decides which criterion is next | `assistant-platform.ts` (hook), `assistant-runtime.ts` (tool_denial branch, `clarify_stay` reply), `shortlet-assistant-pack.ts` (hook) - AC1, AC2, AC4 |
| 0106 | Chip input is structured guest input: a tapped chip is an ordinary typed turn, the planner and the date authority decide; chips never set state | AC3 (`test/assistant-clarification-chips.test.ts`) |
| 0106 | Date authority stays fail closed: no relative-date chips on the assistant path (issue 04 not landed); no invented date is offered (issue 15) | AC2 (no `when` chips), `clarificationQuickReplies` |
| 0106 | Chips are never added to out-of-scope, support or redirect replies (scope verdict is authoritative) | AC4 (`scope_redirect` and `support_guidance` returns carry no chips) |
| 0080 | Parity: the deterministic path picks the next criterion with the same rule (`nextMissingStayCriterion`, extracted from `resolveStayRequestContext`) | AC1, AC2 |
| 0078 | Chip targets 44px, no horizontal overflow at 320 and 1280 | AC5 (`.ui-chip` `min-block-size: var(--control-min-target)` = 2.75rem) |
| 0075 | Chip text is copy from the closed lists only; no guest value or id in logs | `quickRepliesFor` (existing copy); diagnostics unchanged |
| 0077 | Guest copy lives in `guest-content.ts` (no new copy added: chips reuse the existing closed lists) | copy location |

Commands and counts (agent, 2 Nov 2026):

- Red first: `env -u LLM_API_KEY npx tsx --test test/assistant-clarification-chips.test.ts`: 1 pass / 3 fail of 4. AC2 failed on the shell's own reply to the guests chip, which carried the relative chips "This weekend", "Next weekend", "Next Friday" on an assistant thread (a real defect, not a test artefact). AC3 failed on the missing area chip. AC4 passed before the change (guard test: no chips on scope or support replies).
- Red first: `env -u LLM_API_KEY npx tsx --test test/assistant-closed-lists.test.ts` after the AC4 extension: 7 pass / 1 fail of 8 (the chips assertion).
- Red first: `env -u LLM_API_KEY SHORTLET_CHROME_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome SHORTLET_CHROME_NO_SANDBOX=1 npx tsx --test test/assistant-clarification-chips-chromium.test.ts`: fail (no `.quick-reply` chips rendered, timeout).
- Green: chips file 4/4 pass; closed-lists 8/8 pass; the AC5 browser test 1/1 pass (Chrome for Testing 153, headless, real layout). Screenshots, written with `SHORTLET_CAPTURE_DIR=screenshots/10`: `screenshots/10/chips-320.png`, `screenshots/10/chips-1280.png` (not committed).
- Deterministic chips in a real browser: `test/guest-discovery-reasons-chromium.test.ts` 1/1 pass (unchanged behaviour on non-assistant threads).
- Non-browser assistant set, one run, 51 files (every `test/assistant-*.test.ts` without a real browser, plus `shortlet-assistant-evals`, `guest-must-fix-ux`, `guest-discovery-reasons`): 447 tests, 446 pass, 1 fail. The failure is `assistant-recording-clients.test.ts` ("Live recording refuses an --out inside test/fixtures ... a junction into it"): `ENOTDIR` from `rmdirSync` on a Linux symlink in the test's own cleanup (line 268). That file is unchanged; the failure is environment-specific (Windows junction semantics), not the chips.
- Recorded journeys: `test/assistant-recorded-journeys.test.ts` 5/5 pass (the `missing-information-clarification` replay still matches its recorded messages).
- Types: `env -u LLM_API_KEY npm run check`: exit 0, zero `error TS` lines, worker bundle guard passes.
- Not run per Test scope: the full `npm test` and `npm run test:workers` (once per batch, before merging to main).

Definition of Done (`docs/agents/issue-tracker.md`):

1. Every AC has a dedicated test named after it: AC1, AC2, AC3, AC4 in `test/assistant-clarification-chips.test.ts`; AC5 in `test/assistant-clarification-chips-chromium.test.ts` (kept apart so the runner's phase 2 picks it up as a browser file). The closed-lists AC4 test was extended, not duplicated. Done.
2. Failure paths: AC4 asserts a scope redirect and a support reply carry no chips; the closed-lists AC4 asserts the area refusal with its chips and no search; AC2 asserts the dates reply carries no chips. Done.
3. ADRs cited: the table above (0099, 0106, 0080, 0078, 0075, 0077), at the call sites where the constraint is non-obvious. Done.
4. No unused injected dependency: no new constructor parameter. `clarificationQuickReplies` is called by the runtime (both reply sites and the refusal branch), the shell (`#clarificationChips`) and `AssistantRuntime.clarificationQuickReplies`. Done.
5. No invented policy: the chip sets are `quickRepliesFor` (existing closed lists); the criteria order is the deterministic resolver's own rule, now one function (`stayCriteriaGap`). No new numbers, no new copy. Done.
6. No credential or guest value in logs: no logging added; chip text is the closed copy only. Done.
7. `npm run check` passes (exit 0). The full `npm test` is deferred to the batch pre-merge gate per Test scope (CLAUDE.md and AGENTS.md), so it is not run here; the item is not satisfied for this commit until that gate runs. Stated plainly.

Design decisions and deviations (please review):

- "When" chips: none. The owner's default allowed a date chip only when it can be derived from the clock. Every derivable date (a clock-relative day or "N days ahead") is a date the server picks for the guest, which issue 15 removed as an invented default. The deterministic relative chips ("This weekend") are not resolvable by the assistant until issue 04. So on the assistant path the `when` criterion gets the plain-word dates sentence and no chips. AC2's "offers the date choice" is therefore met only as the dates sentence. Owner decision if a date chip is wanted.
- Reply sentence for `when`: when the next missing criterion is the date and the plan is `clarify_stay`, the reply is `GUEST_ASSISTANT_COPY.datesClarification` (the existing plain-word sentence). This needed `renderReply` to receive the task state (an optional 4th argument; the commerce pack ignores it).
- OPEN, owner decision (copy): for `where` (and `who`, `nights`) the reply stays the existing `stayClarification` sentence, "How many nights will you be staying, and for how many guests?". With area chips beneath it, the sentence does not ask for the area (the screenshot shows this). I did not change it because the recorded journey `missing-information-clarification` asserts that message; changing it means re-recording a fixture. Suggested: a `where` sentence in `guest-content.ts` and a re-recorded journey, owner to approve.
- Criteria chip replies on assistant threads: `#handleCriteriaEdit` and the deterministic typed clarification now take their chips from the pack when the assistant holds the thread (`#clarificationChips`), so the strip's own reply no longer offers relative dates on those threads. Threads without the assistant keep the deterministic chips unchanged.
- `AssistantGuestRefusalError` gained an optional `clarification: "area"`. The area check sets it; a Continuous Occupancy refusal does not, so it gets no area chips.
- The shared next-criterion rule: `stayCriteriaGap` in `concierge.ts`, used by `resolveStayRequestContext` (its tail moved verbatim into `confirmedOrSearch`) and by the pack. Same order: where, who, when, nights.
- Test helpers: `coldTurn` moved to `test/helpers/guest-date-fixtures.ts` (the closed-lists test uses it now); `ScriptedTurn` gained `reply` and `scope`.
- The chips appear on the typed clarification path after a provider fallback too, because the thread is still the assistant's. This keeps relative dates off assistant threads.

## Answer

- `apps/local-guest/src/concierge.ts`: `stayCriteriaGap` (one rule for the missing criterion, the resolver's order), `resolveStayRequestContext` uses it; the completed tail is `confirmedOrSearch`.
- `apps/local-guest/src/assistant/assistant-platform.ts`: `AssistantClarificationKind`, the optional pack hook `clarificationQuickReplies`, `renderReply` gets the task state.
- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`: `clarificationChipsFor` (area kind gives the area chips; other kinds use the next criterion; `when` gives none); the hook is wired; `renderShortletReply` picks the dates sentence for the `when` gap.
- `apps/local-guest/src/assistant/assistant-runtime.ts`: `quickReplies` on the turn output for `clarify_stay` replies and for the stay, date and area rejections (not for scope, support or redirect); `clarificationQuickReplies(threadId, kind)` accessor.
- `apps/local-guest/src/assistant/date-tokens.ts`: `AssistantGuestRefusalError` takes the optional `clarification: "area"`.
- `apps/local-guest/src/shortlet-app.ts`: `#assistantResult` passes `quickReplies` through; `#clarificationChips` used by the criteria edit and the typed clarification.
- `test/assistant-clarification-chips.test.ts` (new, AC1 to AC4), `test/assistant-clarification-chips-chromium.test.ts` (new, AC5), `test/assistant-closed-lists.test.ts` (AC4 now asserts the chips), `test/helpers/guest-date-fixtures.ts` (`coldTurn`, `reply`, `scope`).
- Screenshots: `screenshots/10/chips-320.png`, `screenshots/10/chips-1280.png` (not committed).

- Owner decision (2 Nov 2026): deferred: the area question still shows the nights-and-guests sentence under the area chips. Fixing it needs a new "where" sentence and a re-recorded missing-information-clarification journey. Known gap, not fixed here. Real-Chrome AC5 (test/assistant-clarification-chips-chromium.test.ts) passes on 7910c40.
