# Assistant: answer facility questions from the listing, and reply for the booking stage

Status: resolved
Type: AFK
Blocked by: 08
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

- The deterministic `#stageReply` (`shortlet-app.ts:1120`) answers "is there parking?" from `unit.amenities` only: "Yes: <title> lists Parking" or "Parking isn't listed for <title>, so I can't confirm it." The assistant's details reply lists all amenities (`shortlet-assistant-pack.ts:980`) but gives no per-question answer, so the honest "not listed" answer depends on the model.
- `#capabilityReply` (:1166) tells the guest what they can do at each stage (request with the Operator, offer ready, payment, booking). The assistant has no equivalent.

## What to build

- A pack reply for facility questions on the selected stay, using the shared amenity table (issue 08) and the same copy.
- Stage-aware fallback copy in the pack's stage handlers, reusing the `#capabilityReply` text (moved to `guest-content.ts`).

## Acceptance criteria

- [x] AC1: With a stay selected, "is there parking?" gives the listed answer for a unit that lists parking.
- [x] AC2 failure path: "is there a gym?" gives the "isn't listed, so I can't confirm it" answer and never says yes.
- [x] AC3: After submit, a vague turn gets the request-stage reply.
- [x] AC4: Guest text is never echoed in the reply (ADR 0075).
- [x] AC5: Same answer as the deterministic path (parity test).

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0080 | Parity | AC5 |
| 0075 | No echo of guest text | AC4 |
| 0077 | Copy from one module | AC1 to AC3 |

## Comments

### Triage note (agent, 2 Nov 2026)

Blockers: 08 is resolved (commit 1d6fc34). No open blocker.

What the code does today and where it overlaps:
- Issue 08 gives the amenity word table (`stay-vocabulary.ts`, `searchAmenityIdsFor`) and the catalogue `GUEST_AMENITY_IDS`. AC1, AC2 and AC5 can reuse them. A word outside the catalogue (gym, per 08) has no id, so "is there a gym?" needs a separate rule for the answer.
- The assistant has no facility answer today. A parking question goes to the details reply, which lists all amenities (the issue cites `shortlet-assistant-pack.ts:980`). I found no per-question path in the pack.
- The seam from issue 12 is reusable. `answerValidatedTurn` (`assistant-platform.ts`, called in `assistant-runtime.ts` before the planner loop) gives a reply with no planner call and no tool. Facility answers (AC1, AC2) and the stage reply (AC3) can use the same hook. Its order against the `change` answer must be set.
- Overlap with issue 09 AC4 ("with a gym"). Two issues would give two different copies for the same word: "isn't listed, so I can't confirm it" here, and an unsupported-preference note there, with the search going on. Recommended split: a question about a facility is answered here, and a request that includes one is noted in 09. Both ACs must state this.
- AC3 (request-stage reply after submit): nothing in the pack returns the capability text. `#capabilityReply` (`shortlet-app.ts:1096`) is deterministic only, and its copy must move to `guest-content.ts` (ADR 0077). Today a vague turn after submit gets the scope clarification, so AC3 needs the hook and must keep the planner out.
- Adding a facility intent to `CONCIERGE_INTENTS` changes the ADR 0106 list. Issue 12 added `change` and listed it as an owner decision. Either do the same here, or answer with `details` and no new intent.
- AC1 is a closed amenity id chosen by the model from the enum. The answer itself must come from `unit.amenities`, not from the model. The issue should say so.

Decisions needed before ready-for-agent:
1. Gym: facility answer here, or unsupported-preference note in 09 (see above).
2. Facility intent: new closed intent (owner veto, as for 12) or `details`.

Recommended next status: `needs-info` until both are answered, then `ready-for-agent`.

### Triage note (agent, 2 Nov 2026, second pass)

This pass corrects one claim in the note above: `answerValidatedTurn` cannot be reused for AC1 and AC2 as it stands.

**1. Blockers.** 08 is resolved (commit 1d6fc34). No open blocker. 12 (which added `answerValidatedTurn`) is also resolved (commits a63f498 and b576455).

**2. What is delivered, and what is missing.**

Delivered:
- The word table: `AMENITY_ALIASES` in `apps/local-guest/src/stay-vocabulary.ts:14` to :38 (pattern, label, catalogue ids). Catalogue-less entries are gym, kitchen and balcony (`ids: []`, `unsupportedLabel`). `searchAmenityIdsFor` (:46) and `unsupportedAmenityLabelFor` (:63) read the model's argument values, not guest text.
- The deterministic answer: `#stageReply` (`apps/local-guest/src/shortlet-app.ts:1054` to :1082) runs `amenityQuestions(text)` (`concierge.ts:396`), a regex over guest text, and answers from `unit.amenities`. Its copy is inline at `shortlet-app.ts:1065` ("isn't listed for ... so I can't confirm it" and "Yes: ... lists ..."), not in `guest-content.ts` (ADR 0077 gap to fix in this issue).
- The selected stay's amenities are in task state: `AssistantStayReference.amenities` (`assistant-state.ts`), with `selectedStayRef` naming the stay. So the answer can use the shortlist entry without a unit lookup.
- The assistant `details` reply lists every amenity (`GUEST_ASSISTANT_COPY.details`, called from `shortlet-assistant-pack.ts:1162`). It is not a per-question answer, so AC1 fails today.
- The stage copy: `#capabilityReply` (`shortlet-app.ts:1096`) is deterministic only. The pack has no equivalent.
- The seam: `answerValidatedTurn` (`assistant-platform.ts:172`, wired in the pack at `shortlet-assistant-pack.ts` around :1279) returns a reply with no planner call. It receives only `{ intents, slots, taskState }`.

Missing:
- A facility value. `answerValidatedTurn` cannot see "parking", so it cannot answer AC1 or AC2 on its own. My earlier note said it could be reused as is. That was wrong for facility questions. The hook still works for AC3 if the turn has no intents (see 3e).
- A closed facility argument on the planner's tool (see 3b).
- The stage reply text (AC3), and moving the stage and "isn't listed" copy to `guest-content.ts`.
- The parity test (AC5), which comes with issue 16.

AC3 fails today for a reason that is not a design choice. A vague turn after submit goes to the planner, and `renderShortletReplyBody` (`shortlet-assistant-pack.ts:1139`) chooses the stay-clarification copy when the guest's text contains "stay", "place" or an area name (regex over guest text). See 3g.

**3. Owner questions and risks.**

a. **Gym: 11 or 09.** Recommended split: a question about one selected stay's facility ("is there a gym?", with a stay selected) is answered here: "A gym isn't listed for <title>, so I can't confirm it." A search wish ("with a gym", a catalogue-less amenity in a search) stays in 09 (the unsupported-preference note, search runs without the filter). Both ACs must say so. The split has to be made by the planner's chosen tool and argument (`get_unit_details` with a facility value vs `search_stays` with `requiredAmenities`/unsupported labels), not by a regex over guest text. Owner to confirm.

b. **Facility mechanism (closed value; owner veto like 12's `change`).**
- Option 1 (recommended): an optional closed `facility` argument on `get_unit_details`. Its enum is `GUEST_AMENITY_IDS` plus the three catalogue-less labels (gym, kitchen, balcony). The server answers from the selected stay's amenities. Reply kind `show_details`, which already exists. No new intent, and no new reply kind (ADR 0106 reply kinds already include details).
- Option 2: a new classifier intent or slot. That changes the closed list at `scope-classifier.ts:3` and the classifier schema (seven slot keys, :31 to :35, :57). It needs owner sign-off.
- Either way the answer text comes from `unit.amenities` through the server, never from model prose (ADR 0106).

c. **Word table.** Keep `AMENITY_ALIASES` as is. Note that `light|power` maps to "Backup power" and `ac` maps to air conditioning. Those are existing 08 choices.

d. **The deterministic path keeps its regex.** `amenityQuestions` and `QUESTION_PATTERN` (`concierge.ts:396`) match guest text on the deterministic path. That is existing behaviour. This issue must not add a regex over guest text on the assistant path (RULES).

e. **Stage reply (AC3): where it goes.** The only text hook is `answerValidatedTurn`, which runs when the turn's intents are validated. A vague turn is `intents: []` (the classifier prompt says "For out_of_scope and unclear, intents must be an empty array"). Owner decision: after a request is sent, an empty-intent turn gets the request-stage reply from the hook, with no planner call. This is a fixed clarification (ADR 0106: unknown or unrelated requests get a fixed clarification or scope redirect). Support turns carry the `support` intent, so they are not affected.

f. **Copy.** The `#capabilityReply` text and the "isn't listed" copy both move to `apps/web-agent/src/guest-content.ts` (ADR 0077), so both paths render the same sentence. Guest text is never echoed (AC4, ADR 0075).

g. **Keyword residue in `renderShortletReplyBody`** (issue 14's open items, still in the code):
- The support branch, `/active stay|locked out|access|safety|emergency/i` (`shortlet-assistant-pack.ts:1116`), chooses the emergency or general support copy from guest text. The RULES forbid phrase lists in reply rendering. ADR 0106 requires urgent stay/access concerns to get support guidance. The fix is a closed value from the model (for example a support reply kind with an urgency field). The owner must decide, because that changes the closed reply kinds.
- The stay-clarification branch, `/how many|nights|\bstay\b|somewhere|\bplace\b|lagos|abuja|lekki|ikoyi/i` (`:1139`), decides the AC3 copy. It must go for AC3 to pass honestly.
- The fixture in `scripted-assistant-model.ts` has a relative-date branch (issue 14). It is test-only.
- Recommended: remove the stay regex as part of this issue (it is on AC3's path). Leave the support regex for the owner, as issue 14 suggests, with a note.

h. **Facility questions with no stay selected.** AC1 says "with a stay selected". Owner: with no stay selected, should a facility question get the stay-picker reply, or the existing `clarify_stay` copy? The deterministic path returns the capability reply (`#capabilityReply`), so the two paths differ today. Recommend: match the deterministic path.

**4. Recommended status, order and split.**
- Recommended status: `needs-info`. Move to `ready-for-agent` once the owner answers (a) the gym split and (b) the facility mechanism. (e) and (g) can be answered with them. I have not changed the Status line.
- Order: after 04 and 05 if they touch the same functions. 11 changes `search_stays` argument handling only through `get_unit_details`, but it does change `renderShortletReplyBody`, which 04 also reads. Sequence 11 after 04.
- Suggested split: 11a is facility answers (AC1, AC2, AC4 and the facility part of AC5). 11b is the stage reply and copy move (AC3 and the stage part of AC5), which depends on (e). 11b is small and could go first, if the owner decides (e) quickly.

- Owner decision (2 Nov 2026): moved to ready-for-agent. Order: 04+05 (one agent), 11, 13a, then 13b and 16.

### Implementation (agent, 2 Nov 2026)

Decisions taken, from the triage notes and the owner's move to ready-for-agent. The owner's answers to the gym split and the facility mechanism are not separately recorded in this file; these are the recommended options and the owner should confirm them.
- Gym split (triage 3a): a facility question about the selected stay is answered here. A search wish ("with a gym") stays in issue 09.
- Facility mechanism (triage 3b, option 1): an optional closed `facility` argument on `get_unit_details`, enum from the shared alias table (`FACILITY_KEYS`, `stay-vocabulary.ts`). No new classifier intent, no new reply kind.
- Stage reply (triage 3e): a vague turn after a stay is sent is answered by the pack's `answerValidatedTurn` hook with no planner call. Before a send it keeps the fixed clarification.
- Unclear turns: the runtime (`assistant-runtime.ts`) lets an unclear verdict reach the hook only when the pack returns an answer. Otherwise it returns the fixed clarification as before.
- Copy: `GUEST_FACILITY_COPY` and `guestCapabilityReply` are in `apps/web-agent/src/guest-content.ts` (ADR 0077). The deterministic `#stageReply` and `#capabilityReply` now call them, with the same strings.

ADR table:

| ADR | Constraint | Where |
|---|---|---|
| 0106 | Closed tool values; server computes the answer; no fast path around the model; cold restore before each event | `get_unit_details.facility` schema; `executeAssistantTool`; the unclear hook in `assistant-runtime.ts` |
| 0080 | Same answer on both paths | AC5 tests; shared copy |
| 0075 | No guest text in replies | `renderShortletReplyBody` uses only the closed key, the stay title and the amenity label (AC4 tests) |
| 0077 | One copy module | `guest-content.ts` helpers |
| 0005, 0060 | Stage reply names the sent Booking Request, not a Reservation | `guestCapabilityReply` `request` branch |
| 0099 | Domain logic in the pack, not the runtime | runtime change only lets the pack's answer through |

Known deviations and open items:
1. AC3 uses the `answerValidatedTurn` hook (triage 2nd pass seam), not the pack's stage handlers as the issue body wrote. Recorded as a deviation.
2. A facility answer for a stay also places the existing unit card (`get_unit_details` surface, existing behaviour). The text is what is compared.
3. Triage (h), facility question with no stay selected: unchanged. The planner may still pick a shortlist stay through `get_unit_details`. Owner question open.
4. Triage (g), the stay-clarification regex in `renderShortletReplyBody` (`/how many|nights|\bstay\b|somewhere|\bplace\b|lagos|abuja|lekki|ikoyi/i`) and the support regex remain. AC3 no longer reaches them. The support regex is still for the owner (issue 14).
5. A vague turn after send is recorded as `successful_model_handling`, as issue 12's change explanation is. Owner may want a distinct closed outcome.

Commands and counts:
- `env -u LLM_API_KEY npx tsx --test test/assistant-facility-answers.test.ts`: 9 pass, 0 fail (new file; 9 tests, one per AC plus failure-path and parity tests).
- Affected non-browser files (list in scratchpad `affected-files.txt`, 78 files, excluding chromium, commerce, paystack, landing-page and pilot-agent): `env -u LLM_API_KEY npx tsx --test <files>` gave 734 tests, 733 pass, 1 fail. The failure, `guest-request-handler.test.ts` "ADR 0101 ... commerce", is an env gap: it needs `COMMERCE_REFERENCE_HMAC_KEY` unless `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow`. Re-run with those test-only switches: 734 tests, 734 pass, 0 fail.
- `env -u LLM_API_KEY npm run check`: exit 0 (final tree).
- Not run here: full `npm test` and `npm run test:workers`, left to the batch gate per the Test scope rules. No real-Chrome file run (no screen changed).

Definition of Done:
1. Every AC has a dedicated named test: yes (AC2, AC3, AC4 and AC5 each have a failure-path or parity test of their own).
2. Failure paths asserted: yes (gym never "Yes"; unlisted catalogue id; before-send vague turn keeps the fixed clarification; no echo).
3. ADRs listed and cited: yes (table above).
4. No unused injected dependency: no new constructor parameters.
5. No invented policy string: copy moved, not created; facility keys derived from `AMENITY_ALIASES`.
6. No bearer credential in logs or audit: none added.
7. `npm run check` passes: yes. `npm test` full run: left to the batch gate (not run per issue).
