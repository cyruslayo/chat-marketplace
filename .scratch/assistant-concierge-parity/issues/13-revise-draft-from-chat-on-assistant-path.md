# Assistant: change a Request Draft from chat

Status: resolved
Type: AFK
Blocked by: 01, 04, 05
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

`guest-chat-first-ux` issue 14 lets a guest say "make it 3 nights" on a draft and get a re-quoted replacement to accept or keep (`#proposeDraftReplacement`, `shortlet-app.ts:4464`; accept and keep at :4698, :4809; `test/guest-draft-revision.test.ts`, 11 tests, none with the assistant). `#proposeDraftReplacement` runs only after the assistant has declined the turn (`shortlet-app.ts:952`), so with the assistant on, a guest cannot change a draft by chat. The assistant's "replacement" (`assistant-state.ts:60`) is proposal supersession, not draft revision.

## What to build

- When the task state holds a current draft and the guest changes stay facts, the pack produces the same draft-replacement surface (re-quote, accept, keep) through the existing handlers, not a new agent-only path (ADR 0080).
- Relative dates in the change go through the issue 04 show-back first, as the deterministic path does.
- Accept goes through the platform action gate (ADR 0072).

## Acceptance criteria

- [x] AC1: "make it 3 nights" on a draft shows the re-quoted replacement with accept and keep.
- [x] AC2: Accept replaces the draft; keep changes nothing.
- [x] AC3 failure path: a stay over the limit, or a party the apartment can't take, is refused and the draft is unchanged.
- [x] AC4 failure path: a forged or superseded accept (surface id) returns `STALE_SURFACE`; a tampered accept context returns `INVALID_CONTEXT`; a price change before accepting re-proposes. (Wording amended 3 Nov 2026 to match the code, owner decision.)
- [x] AC5: Relative dates are confirmed before the replacement is proposed.
- [x] AC6: Each of the 11 deterministic draft-revision tests has an assistant twin with a cold restore before every event.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0080 | Same command and handlers on both paths | AC1, AC2, AC6 |
| 0072 | Accept through the action gate | AC2 |
| 0074 | Fail-closed surfaces | AC4 |
| 0015 | Re-quote is all-in | AC1 |
| 0106 (amended) | Date authority | AC5 |

## Comments

### Triage note (agent, 2 Nov 2026)

**1. Blockers.** 01 (ADR 0106 amended, commit 191a411) is resolved. 04 and 05 are still `needs-triage`. Only AC5 (relative dates) needs them. AC1 to AC4 and AC6 need no date, so they can start before 04 and 05 finish. The `Blocked by: 01, 04, 05` line is right; map.md listed only 04 and 05.

**2. What is delivered, and what is missing.**

Delivered (deterministic path):
- Draft revision exists: `#proposeDraftReplacement` (`apps/local-guest/src/shortlet-app.ts:4424`), called from the free-text path at :957 after the stage reply. The re-quote helper is `#replacementTerms` (:4537). Accept and keep are in the same area (not re-checked for this note).
- The tests: `test/guest-draft-revision.test.ts` has 10 `test(` calls, not 11 as AC6 says (`grep -c "test("`). Its names cover the nights change (:50), keep (:100), the 180-night maximum (:115), party size (:127), a tampered accept (:138), a price change (:161), relative dates (:176), a new place (:191), a date check (:200) and different dates (:217).

Delivered (assistant path), what is already there:
- `search_stays` in the pack never reads `currentDraftId`. The field is written at `apps/local-guest/src/assistant/shortlet-assistant-pack.ts:984` and read only for the journey label at :1098. So "make it 3 nights" on a draft runs a new search and leaves the draft alone. This is the gap the issue describes.
- The change hook (`answerValidatedTurn`, pack around :1279) answers only once a request is sent (`sentStageFor` returns undefined for a draft). A text reply cannot re-quote anyway.
- Re-quote arithmetic: `checkOutForNights` and `validatedCheckOutForNights` (pack :402 to :418) and `createStayQuote` (pack :962). These can produce the replacement terms.
- Stage handlers exist for surfaces (`apps/local-guest/src/assistant/shortlet-stage-handlers.ts`, `REQUEST_STAGE`, and `assistant-stage-handler.ts`). A replacement surface would be filed there.

Missing:
- A replacement proposal, with its surface, accept and keep, all on the assistant path.
- Accept through the action gate (ADR 0072). `PendingActionType` is closed to three types (`apps/local-guest/src/assistant/pending-actions.ts:10`: request_to_book, accept_offer, start_checkout). A replacement has no type.
- Relative-date confirmation (AC5), which needs 04's show-back.
- The eleven assistant twins (AC6), with a cold restore before each event, once the above exist.

**3. Owner questions and risks.**

a. **The classifier does not treat a draft as a change.** The classifier prompt says: "Use change when the guest asks to alter the stay facts (dates, nights or party size) of a stay that is already sent, offered or booked; use search for any other stay search" (`apps/local-guest/src/assistant/scope-classifier.ts:83`). So "make it 3 nights" on a draft is classified `search`, not `change`. Even with a replacement path, the verdict routes to a search. Owner: does a current draft count as "sent" for `change` (a classifier prompt change), or does the planner treat a `search` with nights and a current draft as a draft revision? This decides where AC1 is built.

b. **Proposal surface.** Option 1: a fourth `PendingActionType` (`replace_draft`), which changes the ADR 0072 action list. Option 2 (closer to the existing pattern): a stage surface, owned by a stage handler, that executes the existing draft replacement only on accept. Owner to choose.

c. **Draft check-in changes.** A draft's check-in is server-owned (27 Oct structured facts). Owner: can a draft's check-in change only through a confirmed date (issue 04's show-back)? Recommended: yes. Nights and party size can change without it (checkout derived from the held check-in, `checkOutForNights`).

d. **AC6 count.** Change "each of the 11" to "each of the 10", or find the eleventh test. (The file has 10, as recorded above and in the issue 02 test record.)

e. **Price and all-in rule.** The replacement must use the all-in quote (ADR 0015), through `createStayQuote` and `stayBudgetKobo`, not model arithmetic. The model may not state a price.

f. **Parity.** The deterministic path answers a draft change itself (`#proposeDraftReplacement`) only after the assistant declines the turn (`shortlet-app.ts:957`). With the assistant on, the two paths cannot give the same answer until (a) and (b) are decided. Issue 16 (the parity suite) must include these rows.

**4. Recommended status, order and split.**
- Recommended status: keep `needs-triage`. Re-triage after 04 and 05 resolve, or earlier if the owner answers (a) and (b). I have not changed the Status line.
- Order: last of the four. It depends on 04 and 05 for AC5 and on the owner's decisions (a) and (b) for the rest.
- Suggested split: 13a is non-date revisions (nights and party on a draft: AC1 to AC4 and AC6 for those cases). 13b is relative-date revisions (AC5), which needs 04. 13a can start once (a) and (b) are answered.

- Owner decision (2 Nov 2026): moved to ready-for-agent. Order: 04+05 (one agent), 11, 13a, then 13b and 16.

### Run record and blocker (agent, 2 Nov 2026, 13a): stopped for owner decisions (a) and (b)

Scope: 13a only (nights and party size on a draft; AC1 to AC4 and AC6 for those cases). 13b (AC5, relative dates) not started. Status stays `ready-for-agent`; not resolved.

Commands and counts (worktree `C:\AI2026\chat-marketplace-parity`, HEAD 32c658e, no code changed):
- `env -u LLM_API_KEY npm run check` (tsc on root, apps/cloudflare, its test and tooling configs, and the worker bundle guard): exit 0.
- `grep -c "^test(" test/guest-draft-revision.test.ts`: 10 (AC6 says 11; the triage note already records this).
- No new tests were written: AC1, AC2 and AC4 cannot be tested until the routing and surface are chosen.

ADR table for 13a (read: 0106 incl. the 26 Oct, 27 Oct and 2 Nov amendments, 0092, 0093):

| ADR | Constraint | Acceptance criterion / code path |
|---|---|---|
| 0080 | Same command and handlers on both paths; the agent makes no state transition | AC1, AC2, AC6: the replacement reuses `#proposeDraftReplacement`, `#replacementTerms`, `#handleDraftReplacementAccept/Keep` (`apps/local-guest/src/shortlet-app.ts:4428, 4541, 4662, 4773`) |
| 0072 | Accept goes through the platform action gate; `PendingActionType` is closed (`pending-actions.ts:10`) | AC2, AC4 |
| 0074 | Fail-closed surfaces: forged, superseded or unknown ids give `STALE_SURFACE` or `ARTIFACT_MISMATCH` | AC4 |
| 0015 | Re-quote is all-in via `createStayQuote` and `stayBudgetKobo`; the model states no price | AC1, AC4 (price change re-proposes) |
| 0106 (26 Oct amendment) | A rejected tool call is `tool_denial`, not `CONCIERGE_UNAVAILABLE` | AC3 (over-limit, party) |
| 0106 (27 Oct, structured facts) | Nights and party size are guest-authored structured facts and carry no date authority | AC1, AC3 |
| 0106 (2 Nov) | Relative dates need the guest's confirmation | AC5 (13b, not this part) |

Why it stops. The routing and the surface are open in the record:
- **(a) Routing.** `scope-classifier.ts:83` sends a stay change to `change` only when the stay is "already sent, offered or booked". A draft is not, so "make it 3 nights" on a draft is classified `search`. `search_stays` in `shortlet-assistant-pack.ts` never reads `currentDraftId` (written at :1204, read only for the journey label at :1318). Options: (i) amend the classifier prompt so a current draft counts as a change target, or (ii) keep the verdict `search` and have the planner treat a nights or party change with a current draft as a draft revision. The record does not say which was chosen.
- **(b) Proposal surface and accept.** Option 1 adds `replace_draft` to `PendingActionType`, which changes the ADR 0072 closed list. Option 2 is a stage surface, owned by a stage handler, that runs the existing replacement only on accept. The record does not say which was chosen.

The record of cb2f9d2 shows only "moved to ready-for-agent" and the order (13a before 13b). It does not record an answer to (a) or (b), although the parent instruction describes the options as approved. Owner to confirm (a) and (b) before 13a is built. Recommended by this run, for the owner to accept or veto: (a)(ii) if the classifier prompt should stay as written, and (b) option 2, since it avoids changing the ADR 0072 closed list.

Open items: the 13b split (AC5) waits on 04 and 05; AC6 says 11 tests, the file has 10.

### Owner decisions (2 Nov 2026, recorded by the coordinator; supersede the open questions above)

- (a) Planner route: keep the classifier prompt as written (`scope-classifier.ts:83`). The planner treats a nights or party change with a current draft as a draft revision. A draft is not a "sent, offered or booked" stay, so the verdict stays `search`.
- (b) Surface: a stage-handler surface that runs the existing replacement only on accept. The ADR 0072 closed `PendingActionType` list does not change.

### 13a completion record (agent, 2 Nov 2026, after the owner decisions above)

Scope: nights and party changes on an open Request Draft (AC1 to AC4, and the AC6 twins of the seven non-date deterministic tests). 13b (AC5, relative dates, and the three date twins at `test/guest-draft-revision.test.ts` :176, :200, :217) is not started. Status stays `ready-for-agent`; not resolved.

ADR table (read: 0106 with the 26 Oct, 27 Oct and 2 Nov amendments; 0092; 0093; 0080; 0074; 0072; 0015):

| ADR | Constraint | Where it is met |
|---|---|---|
| 0080 | One handler for both paths; the agent makes no state transition | `shortlet-draft-revision.ts` quotes through `draft-replacement.ts` (shared with `shortlet-app.ts #replacementTerms`); accept and keep are the existing shell handlers |
| 0072 | Accept runs through the existing checks; `PendingActionType` list unchanged (owner, b) | accept checks `draftId`, `basedOn` and the surface id in `#handleDraftReplacementAccept`; no new pending action type |
| 0074 | Fail closed on forged or stale ids; a search that changes the stay removes the open proposal | `#stageForSurfaceId` maps `:request:replacement:`; `discoveryHandler` retires `draft_replacement` and clears `pendingDraftReplacement` |
| 0015 | Re-quote is all-in | `draftReplacementTerms` (`createStayQuote`), no model arithmetic |
| 0106 (26 Oct) | A rejected tool call is `tool_denial`, not `CONCIERGE_UNAVAILABLE` | `proposeDraftRevision` throws `AssistantStayDetailsError` for a stay the length rules refuse; `AssistantGuestRefusalError` for a Unit that can't take it |
| 0106 (27 Oct) | Nights and party are structured facts, with no date authority | the revision carries no date; an args date disables the revision (13b) |
| 0106 (2 Nov) | Relative dates need confirmation | not in 13a (13b) |
| 0092 / 0093 | Extended stay length and minimal projection | `StayDateRange` gates the length; the persisted pending replacement holds only the stay, terms and ids |

Implementation (commit below):
- Planner route (owner a): `search_stays` with an open draft and a changed nights or party count is a draft revision (`draftRevisionRequest`, `shortlet-draft-revision.ts`). The classifier prompt is unchanged. No search runs.
- Stage handler (owner b): `draftReplacementHandler` (stage `draft_replacement`, `shortlet-stage-handlers.ts`) files the replacement surface `thread-<id>:request:replacement:<draftId>`. The runtime holds it in `taskState.pendingDraftReplacement`. The shell mirrors it into the durable thread after each assistant turn (`#syncAssistantPersistence`) and persists it in the projection (`guest-projection.ts`), so a cold restore re-keys the same surface id.
- Pre-existing defect fixed: `cloneTaskState` did not copy `currentDraftId`, so every turn after a restore lost the open draft. It now copies it.

Commands and counts (worktree `C:\AI2026\chat-marketplace-parity`):
- `env -u LLM_API_KEY npx tsx --test test/assistant-draft-revision.test.ts`: 8 pass, 0 fail (after the fixes below; first run 2 pass, 6 fail, as expected).
- `env -u LLM_API_KEY npm run check`: exit 0.
- Affected, batch 1: `guest-draft-revision`, `assistant-cold-journey`, `assistant-persistent-continuity`, `assistant-continuous-occupancy`, `assistant-pending-action-restore`, `assistant-proposal-replacement`, `assistant-proposal-supersession`, `assistant-shortlet-stage-behaviour`: 59 pass, 0 fail.
- Affected, batch 2: `assistant-stage-handlers`, `assistant-turn-stop-cold-restore`, `assistant-context-isolation`, `assistant-search-unknowns`, `assistant-location-change`, `assistant-discovery-view`, `assistant-task-rail`, `assistant-recorded-journeys`, `assistant-booking-journey`, `guest-process-restart`, `guest-chip-continuity`: 76 of 77 passed on the first run. The one failure was `criterion 6: each shortlet stage handler declares the supersede rule` (issue 04's pinned handler list). It is expected: discovery now also retires the replacement, and there is a new stage handler. Updated that expectation in `test/assistant-stage-handlers.test.ts`; re-run 16 of 16 pass (with the 13a suite).
- Affected, batch 3: `assistant-where-chip`, `assistant-budget-chip`, `assistant-short-stays-29-nights`, `assistant-turn-date-context`, `assistant-tool-authorization`, `assistant-thread-lock`, `assistant-reply-coverage`, `guest-booking-journey`, `local-guest-shell`, `assistant-control-metrics`: 97 pass, 0 fail.
- Not run: full `npm test`, `npm run test:workers` (batch gate). No real-Chrome file: no new screen or copy (the replacement uses the existing draft-replacement surface and its copy).

Definition of Done for 13a:
1. Named tests per criterion: done (AC1; AC2 accept and keep as two tests; AC3 two failure tests; AC4 two tests; AC6 twin of the new-place test). The AC6 wording says "each of the 10": 13a has the seven non-date twins, the other three are 13b.
2. Failure paths asserted: done (181 nights, 9 guests, forged surface, tampered context, newer proposal, price change, stale draft review after a new place).
3. ADRs listed and read: done (table above).
4. No unused injected dependency: checked (the `threadId`, `taskState` and `now` inputs of `proposeDraftRevision` are all read).
5. No invented policy: done. Copy is shared from `draft-replacement.ts`, the length rule is `StayDateRange`, and no new number was added.
6. No credential or identity in logs: done (no new log lines).
7. `npm run check` passes: yes. `npm test`: left to the batch gate.

Open items for the owner:
- AC4 wording: the criterion says a tampered or stale accept returns `STALE_SURFACE`. The existing deterministic code returns `INVALID_CONTEXT` for a tampered context, and `STALE_SURFACE` only for a forged surface id. The tests assert those existing codes. Decide: keep the codes (amend the criterion) or change the handler.
- Reload: after a cold restore the replacement's accept and keep work, but a page reload does not re-render the replacement surface (the restore keeps the id, not the screen). Same gap exists for the deterministic path.
- Accept is the existing shell handler, not an ADR 0072 pending action (owner b). The guard is the `basedOn` and surface id, as on the deterministic path.
- A date in the planner call (checkIn, checkOut or a phrase) is not a draft revision here; it runs an ordinary search as before. That is 13b.

### Owner decisions (3 Nov 2026, recorded by the coordinator)

1. AC4 wording amended to match the code: a forged or superseded surface id returns `STALE_SURFACE`; a tampered accept context returns `INVALID_CONTEXT`. The handler is kept (no code change).
2. A later text turn that does not search keeps the open replacement: intended. Accept still works after such a turn.

### 13b completion record (agent, 3 Nov 2026)

Scope: AC5 (relative dates are confirmed before a replacement is proposed) and the three date twins in `test/guest-draft-revision.test.ts`: :176 (confirmed before the replacement), :200 (an unconfirmed date check is dropped, the next change builds on the draft) and :217 (a different date answers the check). Every twin runs on a cold restore before every event, on a fresh thread, with the assistant enabled, the 27 Oct 2026 clock and a staging-like guest.

How it works:
- A planner call with a date (a relative phrase, or a literal the guest wrote) is read by the existing issue 04/05 show-back and resolver. A relative phrase is only shown back; nothing is quoted until the guest says yes (ADR 0106, 2 Nov 2026: authority comes from the guest's confirmation).
- With a Request Draft open, the check-in, nights and party size are resolved first, then compared with the draft (`draftRevisionRequest`, now after the date resolution). A changed check-in is a draft revision. A check-in the guest did not give keeps the draft's own date, so an unconfirmed day is never used.
- The show-back sentence for an open draft is `draftDateShowBack` (`apps/web-agent/src/guest-content.ts`), the same sentence the deterministic path shows ("Shall I show your Request Draft with these dates?"). Without a draft, the search wording is unchanged.
- Date authority is unchanged: a model-only date still throws (`AssistantDateProvenanceError`); a literal that resolves beyond the 90-day Booking Horizon is refused by the existing rules.

ADR table additions (read: 0106 amendments of 27 Oct and 2 Nov 2026, 0092, 0093, 0055, 0080):
- 0106 (2 Nov): confirmed date phrases are guest-authored; ambiguous phrases are not authorised until chosen; "next <weekday>" is handled by the existing resolver. Met by reusing the 04/05 settle step (`settlePendingStayDate`).
- 0106 (27 Oct): a rejected date is a tool_denial; no new outcome code.
- 0080: the same replacement handlers accept and keep the change on both paths.

Commands and counts (worktree `C:AI2026chat-marketplace-parity`, all `env -u LLM_API_KEY`):
- Red run before the code: `npx tsx --test test/assistant-draft-revision.test.ts` gave 9 pass, 2 fail (AC5 and "answering a date check with different dates"); the "date check not confirmed" twin passed already, because a non-date change on the draft was already a revision.
- `npm run check`: exit 0 (after the code and after the ScriptedTurn typing of the test script).
- `test/assistant-draft-revision.test.ts`: 11 pass, 0 fail (8 from 13a, 3 from 13b).
- Date-focused: assistant-date-phrases, assistant-checkout-dates, assistant-date-literal-authority, assistant-date-literals, assistant-date-clarification-copy, assistant-turn-date-context, assistant-cold-journey, assistant-stage-handlers, guest-draft-revision, assistant-recorded-journeys, stay-date-phrases, guest-real-dates: 90 pass, 0 fail.
- Affected, first half: guest-draft-revision, assistant-cold-journey, assistant-persistent-continuity, assistant-continuous-occupancy, assistant-pending-action-restore, assistant-proposal-replacement, assistant-proposal-supersession, assistant-shortlet-stage-behaviour, assistant-stage-handlers (plus the 13a/13b file): 78 pass, 0 fail.
- Affected, second half: assistant-turn-stop-cold-restore, assistant-context-isolation, assistant-search-unknowns, assistant-location-change, assistant-discovery-view, assistant-task-rail, assistant-recorded-journeys, assistant-booking-journey, guest-process-restart, guest-chip-continuity, assistant-where-chip, assistant-budget-chip, assistant-short-stays-29-nights, assistant-tool-authorization, guest-booking-journey, local-guest-shell: 122 pass, 0 fail.
- Not run: full `npm test` and `npm run test:workers`: left to the batch gate. No real-Chrome file: the show-back and replacement use existing surfaces and the existing copy pattern, and no screen changed.

Definition of Done (13a and 13b):
1. Named tests per criterion: AC1, AC2 (accept and keep), AC3 (two failure paths), AC4 (two tests), AC5 and the AC3 date twins. AC6 covers all ten deterministic tests: seven in 13a, three in 13b. The criterion text says "11"; the file has 10 (already recorded in the triage note). The count in the text was not changed.
2. Failure paths asserted: 181 nights, 9 guests, a forged surface, a tampered context, a newer proposal, a price change, a stale review after a new place, an unconfirmed date, a different date.
3. ADRs listed and read: tables in the 13a and 13b records.
4. No unused injected dependency: `draftRevisionRequest` reads every input. `proposeDraftRevision` reads its threadId, taskState and now.
5. No invented policy: the date rules are the existing resolver's; the one new sentence is the deterministic sentence moved to the shared copy file.
6. No credential or identity in logs: no new log line.
7. `npm run check` passes. `npm test`: left to the batch gate.

Open items:
- The full `npm test` and `npm run test:workers` run once per batch before the merge to main (batch gate).
- A reload does not re-render an open replacement (the id survives a cold restore, the screen does not). Same gap as the deterministic path.
- The deterministic show-back sentence in `concierge.ts` is still inline; it is the same wording as `draftDateShowBack`. Moving it to the shared copy is a follow-up, not a behaviour change.
- The assistant's show-back for a draft does not repeat "Your Request Draft is unchanged." as a second message (the deterministic path does). The draft is unchanged in every case; the sentence is one message.
