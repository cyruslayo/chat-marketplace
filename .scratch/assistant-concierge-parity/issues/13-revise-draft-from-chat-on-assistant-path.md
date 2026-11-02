# Assistant: change a Request Draft from chat

Status: ready-for-agent
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

- [ ] AC1: "make it 3 nights" on a draft shows the re-quoted replacement with accept and keep.
- [ ] AC2: Accept replaces the draft; keep changes nothing.
- [ ] AC3 failure path: a stay over the limit, or a party the apartment can't take, is refused and the draft is unchanged.
- [ ] AC4 failure path: a tampered or stale accept returns `STALE_SURFACE`; a price change before accepting re-proposes.
- [ ] AC5: Relative dates are confirmed before the replacement is proposed.
- [ ] AC6: Each of the 11 deterministic draft-revision tests has an assistant twin with a cold restore before every event.

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
