# Give each task its own chat lane (timeline and model history)

Status: resolved
Type: task
Blocked by: 03b (persisted task ids and list), 03a (pack hooks). Two owner decisions are open and listed in seams.md (O1 restore of model history; O2 where lane timelines persist across a cold restore). Owner release as in 03a (ADR 0107 "Settled", 8 Nov 2026).
Requested: 10 Nov 2026

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 11.3 (lane model) and 11.6 (slice 3b, part 2); [ADR 0107](../../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md) decision 11 (as amended by the dated corrections in ADR 0107); [map](../map.md) slice 3b.

## Why

One guest timeline and one model history serve every task. `GuestThreadState.timeline` (`apps/local-guest/src/shortlet-app.ts`, the timeline field near line 661) is shared, and `AssistantThreadState.conversationHistory` (`apps/local-guest/src/assistant/assistant-state.ts:141`) is shared. `AssistantTask` (`assistant-state.ts:123` to `:134`) keeps only its state, surfaces, badge and unread count. So a switch swaps the workspace but not the chat, and the other agent reads the first agent's history. ADR 0107 decision 11 requires one lane per task.

The seam is already there. `#applyTaskTool` saves and restores each task's workspace (`assistant-runtime.ts:513`), and `syncActiveTask` mirrors the active task into thread fields (`assistant-turn-transaction.ts`, the function near line 94).

## What to build

1. **Lane fields on the task.** `AssistantTask` gains `timeline: readonly GuestTimelineEntry[]` and `conversationHistory: AssistantConversationStep[]`. Each timeline entry may carry an optional `taskId`.
2. **Thread fields become mirrors.** The thread-level `timeline` and `conversationHistory` mirror the active task, as `activeSurfaces` already does through `syncActiveTask`. Writes go to the active task first.
3. **Switch swaps the lane.** Switching or starting a task saves the outgoing lane and restores the target lane through `#applyTaskTool` (`assistant-runtime.ts:513`, `restore` at `:542`). The response's `timeline` is the active lane only.
4. **Isolation.** Planner and classifier context (`#turnContext`, the history passed to the model) read only the active lane. Across lanes only guest-authored text crosses, and only as the turn that triggers a switch (ADR 0107 decision 11; the cross-lane hand-over is 03f's).
5. **Model history not restored.** A cold restore starts every lane's `conversationHistory` empty, as `restoreShortletState` does today (`assistant-runtime.ts:736` and the `conversationHistory.length = 0` line). The projection never stores model text. Whether restore rebuilds history from canonical facts is open decision O1.
6. **Lane timelines across a cold restore (open decision O2).** This issue persists each lane's guest-visible timeline as an optional `lanes` field of the thread projection (`taskId`, `domain`, `timeline`), capped per lane by a named constant (value: open decision O3). Model history is excluded. If O2 chooses a table, this step is replaced by a new issue.
7. **New conversation.** Amended 12 Nov 2026 (owner decision, ADR 0079, issue 13a): "New conversation" is the client thread switch (`client.ts` `startNewConversation`). It starts a fresh thread and carries no lanes, tasks or timeline over. There is no per-lane reset on the server; decision O5 is closed. Verified by AC5.
8. **Client.** `restoreServerState` (`apps/local-guest/src/client.ts:2882`) renders the transcript the server sends for the active lane. The client keeps no lane cache in this issue.

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 11 and the corrections section | One lane per task. Restore by `activeTaskId`. Model history rules are proposed, not settled. | Steps 1 to 6. |
| 0106 "Tools and context" | Rejected or foreign content must not re-enter model history. Filtering keeps committed commands and valid continuity. | Step 4; AC2 and AC4. |
| 0106 (cold restore) | Ids are re-keyed on restore, never re-minted. | AC3. |
| 0106 "Resource controls" | Bounded history (`maxItems`, state summaries). | Step 6 cap; AC6. |
| 0075 | Minimal, redacted interaction data. Timeline text is guest-visible copy only. | Step 6 persists the timeline only, never model text. AC4. |
| 0093 | Minimal projection of guest state. | Step 6. |
| 0074 | Switching supersedes proposals with `task_switched`. | Unchanged; AC1 checks the switch still drops the proposal. |
| 0079 | "New conversation" starts a fresh thread (client thread switch); it keeps committed work visible in the previous thread. No per-lane reset (owner decision, 12 Nov 2026). | Step 7; AC5. |
| 0101 | The platform owns threads and tasks. | Lanes are platform thread state. |

## Acceptance criteria

Each is its own `test()` in `test/assistant-task-lanes.test.ts`.

1. A switch from stays to the fake shop task saves the stays timeline and restores the shop timeline (empty on first visit); switching back restores the stays timeline unchanged. A pending proposal is still dropped on the switch (ADR 0074).
2. An entry written in the stays lane is absent from the shop lane's response (context isolation; the fake shop planner context contains no stays text).
3. After a cold restore, the active lane's timeline and every persisted lane's timeline are restored, with `taskId` values unchanged.
4. After a cold restore the lane's `conversationHistory` is empty, and the stored projection has no `conversationHistory` or model text key.
5. "New conversation" starts a fresh thread that carries no lanes, tasks or timeline over, and the previous thread's lanes are unchanged (owner decision, 12 Nov 2026; replaces the earlier active-lane-reset wording).
6. A lane longer than the named cap keeps the cap; entries beyond it are replaced by one receipt summary, and the stored projection stays under the cap. Test the cap with an injected value.
7. A persisted `lanes` entry whose `taskId` is not in `tasks` rejects the projection (fail closed).
8. A legacy blob with only the top-level `timeline` restores as the stays lane timeline, unchanged.

## Verification

- `env -u LLM_API_KEY npm run check`.
- `env -u LLM_API_KEY npx tsx --test test/assistant-task-lanes.test.ts test/assistant-context-isolation.test.ts test/assistant-task-rail.test.ts test/assistant-task-persistence.test.ts test/assistant-thread-lock.test.ts`.
- `env -u LLM_API_KEY npx tsx --test test/assistant-cold-journey.test.ts test/agent-mode-shell.test.ts` (assistant enabled; cold restore before every event; clock 2026-10-27; staging-like guest with no seeded phone or email). The stays-only transcript must be unchanged.
- If the thread projection write path is changed in a Worker-visible way, run the matching Worker spec only: `npm run test:workers -- apps/cloudflare/test/<spec>.spec.ts` (choose the spec that covers thread persistence; verify before running).
- Record commands and counts under `## Comments`.

## Out of scope

- Lane event rows and export (03e).
- Client lane cache, scroll memory and view transitions (not assigned; see seams.md).
- Model history persistence or rebuild from facts (open decision O1).
- The read-path table split (open decision O2; no issue owns it yet).
- Cross-lane hand-over and undo (03f).

## Comments

### Agent, implementation (Agent modes issue 03d)

Status at this entry: `ready-for-agent`. It is not set to `resolved`: AC5 is blocked (Gap 1), and the once-per-batch `npm test` gate has not run.

**Environment.** `node_modules` in this worktree was a junction to `C:\AI2026\chat-marketplace\node_modules`, which is an empty directory (no packages; created 11 Nov 2026). The lane tests could not load `@cylayo/weaver-core`. I removed the empty junction link in this worktree only and ran `npm ci` here (162 packages; `node_modules/` is git-ignored). The main checkout and the other worktrees were not written to.

**Step 7 check (New conversation, verified before any edit to the reset path).** No server reset exists. `apps/local-guest/src/client.ts` `startNewConversation` writes a new `g-<uuid>` thread id to `sessionStorage` and reloads `/`. It sends no command and never calls `/api/reset`, and the previous thread's lanes stay on the server untouched (the client comment cites ADR-0079 and issue 13a). No server code resets one lane. O5 ("active lane only") therefore cannot be applied as written without changing 13a's behaviour, so I did not change it. AC5 is skipped with its reason; a separate test records the current behaviour.

**ADR table (steps 1 to 3).** Read in relevant part: 0107 (decision 2, decision 11, corrections 1 to 5) and 0106 ("Tools and context", "Resource controls and evaluation"). Read as summary and cited clauses: 0074, 0075, 0093. ADR 0079 was checked for the New conversation wording: its text is about replayable interaction streams and does not contain it; the "committed work stays visible" rule comes from the client comment that cites it.

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 11 | One lane per task: its timeline and its own model history. | Shell lane map keyed by task id (`timelineTaskId`, `laneTimelines`, `#alignTimelineLane` in shortlet-app.ts). Runtime `AssistantTask.conversationHistory`, mirrored to the thread by `syncActiveTask` (assistant-turn-transaction.ts). |
| 0107 decision 2 | Restore by `activeTaskId`; the client never sets the active task. | `#restoredLanes` takes the active lane from the usable list, using the same check as the runtime (`taskListRefusal`). |
| 0107 correction 2 (proposed) | Rebuild model history from facts. | Not done. Owner decision O1: empty. `restoreShortletState` gives every task `conversationHistory: []`. |
| 0107 correction 4 | "New conversation" resets the active lane only (open). | Open; see Gap 1. |
| 0106 cold restore | Ids the guest holds are re-keyed, never re-minted. | Lanes are keyed by the persisted task ids. AC3 checks the stored ids before and after restores. |
| 0106 resource controls | Extra limits are documented configurable engineering settings. | `laneTimelineCap` injectable; default `DEFAULT_LANE_TIMELINE_CAP = 100` (owner decision O3). Bounds 2 to 1000 are engineering bounds, as in 03b. |
| 0106 tools and context | Planner context comes from committed, validated state only. | Planner history is the active task's `conversationHistory`. AC2 checks that no planner request of the shop turn carries stays text. |
| 0075 | Minimal interaction data; no model text stored; no restricted material in logs. | Projection `lanes` stores id, domain and guest-visible copy only. AC4 checks no history key is stored. AC7 checks the diagnostic carries no id or text. |
| 0074 | Fail-closed; a switch removes the open proposal. | Unchanged. AC1 checks the removal notice and that no proposal stays open. |
| 0079 and 13a | Committed work stays visible on New conversation. | Unchanged (a thread switch). Current-behaviour test. |
| 0093 | Minimal projection of guest state. | Task entries stay id and domain only. Lanes add guest copy only. |

**Deviations from the spec (owner to confirm).**
1. Steps 1 and 2 said `AssistantTask.timeline` and a mirrored thread `timeline`. Not built that way. The transcript is shell state (`GuestThreadState`), so the lane map lives in the shell, keyed by task id, and `thread.timeline` is the active lane. A runtime-owned transcript would need seeding whenever a runtime thread is created, and a legacy thread with a transcript but no runtime thread would lose it. Model history is on `AssistantTask` as the spec says. The optional per-entry `taskId` is not added: the lane record carries the id.
2. Switch copy. Every assistant-managed result gets the fixed timeline copy (`#assistantTimelineMessage`), so a switch shows "I can help...", not "Switched to your Shop task." (the response messages are not written to the transcript). The shop lane on first visit therefore holds that one reply, not zero entries. AC1 asserts exactly that.
3. Isolation defect found by AC2 and fixed. `#safeAssistantTimelineMessage` read stays-only thread facts (shortlist, request, offer, discovery), so a shop result showed "I found 1 matching stay in Lekki Phase 1." in the shop lane. A task on another domain now shows `ASSISTANT_CONTROL_COPY.taskClarification` (new copy). Stays threads are unchanged.
4. The refusal reason is `INVALID_TASK_LIST`, from the existing closed enum (the spec names the enum, not a new value). A lanes list naming an unknown task is ignored as a whole; the active lane is the top-level timeline.
5. `lanes` is written only when the thread has more than one task, so a stays-only stored projection keeps its shape.
6. Every restored and written lane (and the top-level timeline) is capped. A stays transcript longer than 100 entries is trimmed on its next write. This only changes transcripts above the cap.
7. New guest copy: `LANE_SUMMARY_TEXT` ("Earlier messages in this task are not shown.", the receipt that replaces trimmed entries) and `taskClarification` ("I can help with this task. What would you like to do next?"). Owner to confirm both.

**Test-first.** `test/assistant-task-lanes.test.ts` was written before the source change. First real run (after `npm ci`, before any source change): tests 9, pass 1 (AC8, the legacy path, already passed), fail 7, skipped 1 (AC5, by design). The first harness draft used `modeScriptModel`, which does not run a real stays search (the search was refused as `tool_denial` and the guest text was discarded). I switched the lane tests to `scriptedPlanner`, the date-aware harness the persistence tests use, before implementing. The shared `coldModeApp` helper gained an optional `appOptions` argument (the cap); existing callers are unchanged.

**Commands and counts** (`C:\AI2026\chat-marketplace-03d`, each prefixed `env -u LLM_API_KEY`):
1. `npx tsx --test test/assistant-task-lanes.test.ts` (red, before the source change): tests 9, pass 1, fail 7, skipped 1.
2. `npm run check`: exit 0 after the implementation and again after the final edits.
3. `npx tsx --test test/assistant-task-lanes.test.ts` (final): tests 9, pass 8, fail 0, skipped 1 (AC5 by design; the current-behaviour test passes).
4. `npx tsx --test test/assistant-task-lanes.test.ts test/assistant-context-isolation.test.ts test/assistant-task-rail.test.ts test/assistant-task-persistence.test.ts test/assistant-thread-lock.test.ts`: tests 57, pass 56, fail 0, skipped 1.
5. `npx tsx --test test/assistant-cold-journey.test.ts test/agent-mode-shell.test.ts test/assistant-pack-contract.test.ts test/agent-mode-follows-task.test.ts test/assistant-persistent-continuity.test.ts test/assistant-pending-action-restore.test.ts`: tests 44, pass 44, fail 0, skipped 0. `agent-mode-shell` and `assistant-cold-journey` are unedited.
6. `npm run test:workers -- apps/cloudflare/test/data-migration.spec.ts` (the stored projection is Worker-visible; the bundle guard runs first): tests 29, pass 29, fail 0.
7. Not run, per Test scope: full `npm test` and full `npm run test:workers`. These are the once-per-batch pre-merge gate.

**Definition of Done (`docs/agents/issue-tracker.md`).**
1. Every criterion has a dedicated named test: not met. AC1 to AC4 and AC6 to AC8 have one each. AC5 is skipped (Gap 1).
2. Failure paths asserted: met where the criterion names one. AC7 (unknown lane id: lanes ignored, active lane kept, one closed diagnostic, no ids or text). AC6 (cap holds; the summary replaces the oldest entries; no repeated summary). AC4 (no history key stored).
3. ADRs listed and cited: met for the rows above. 0074, 0075 and 0093 were read as summary plus cited clauses, not in full; 0079 is checked as stated.
4. No unused injected dependency: met. `laneTimelineCap` is used by `#capActiveLane`, `#persistedLanes`, `#restoredLanes` and the projection.
5. No invented policy string or constant: partly met. `DEFAULT_LANE_TIMELINE_CAP` is owner decision O3. The bounds 2 to 1000 are engineering bounds (as 03b). `LANE_SUMMARY_TEXT` and `taskClarification` are new guest copy, not yet confirmed (Gap 2).
6. No credential or identity material in logs: met. The diagnostic carries the closed reason only.
7. `npm run check` clean: met. `npm test` passes: not run, because it is the once-per-batch pre-merge gate (Test scope).

**Gaps (why the status stays `ready-for-agent`).**
- Gap 1 (AC5, O5): "New conversation" is a client thread switch (13a). The server has no path that resets one lane. Owner to choose: (a) keep the thread switch and drop the active-lane reset from 03d, or (b) add a server lane reset and a control that calls it. Until then AC5 cannot be tested as written.
- Gap 2: copy to confirm: `LANE_SUMMARY_TEXT`, `taskClarification`, and the reply a switch shows in each lane ("I can help...").
- Gap 3: correction 2 (rebuilding model history from facts) is still unconfirmed. This issue restores history empty, per O1.
- Gap 4: the batch gate (`npm test`, and `npm run test:workers` in full) has not run.

**Observations for the owner (not changed here).**
- A non-active task's pending-proposal notice is not persisted across a cold restore. Only the active task's state is restored from the thread (03b's design). AC1 therefore reads the notice on the same application straight after the switch.
- On a turn that switches task, the history commit writes the switching turn into the origin lane (the lane active at the start of the turn). The "canonical task facts" summary in that write is built from the new task's state. It is one summary line per switch turn, with no guest text from the new lane.

**Scope notes.** No formatter was run. `client.ts` is unchanged, so `apps/local-guest/dist/client.js` is not regenerated. `commerce-assistant-pack.ts`, `_headers` and screenshots are untouched. Nothing was pushed, merged or deployed.

### Owner decision, 12 Nov 2026: New conversation keeps the thread switch (supersedes Gap 1 and Gap 2 above)

- **Decision.** "New conversation" stays the client thread switch (ADR 0079; issue 13a). It starts a fresh thread and carries no lanes, tasks or timeline over. No server lane reset is added. Decision O5 is closed. Seams.md O5 is updated, and ADR 0107 has a dated line in its 10 Nov corrections section (item 6).
- **Amended in this issue.** Step 7, AC5 and the ADR 0079 row of the ADR table now say this. The earlier "active lane only" wording is replaced.
- **AC5 (replaced).** The skipped placeholder is gone. The new `test("AC5: ...")` runs with the assistant enabled and a cold restore before every event, on the 27 Oct 2026 clock, with a guest that has no seeded phone or email. It uses the existing helpers. The previous thread gets a stays search, a shop start and a shop turn. A fresh thread id then gets an empty timeline. Its first stays search leaves one active stays task and one lane, with no `lanes` field stored. The previous thread's stored lanes, task ids and active timeline are unchanged. The client-side `sessionStorage` switch is not run in the unit test. The test asserts the server boundary, which is what a new thread id reaches.
- **Copy accepted by the owner.** `LANE_SUMMARY_TEXT` ("Earlier messages in this task are not shown.") and `ASSISTANT_CONTROL_COPY.taskClarification` ("I can help with this task. What would you like to do next?").
- **Behaviour accepted by the owner.** A stays transcript longer than the cap (default 100) is trimmed on its next write, and the oldest entries become one receipt summary. Only transcripts above 100 entries change.
- **Reading scope (DoD item 3).** ADRs 0074, 0075 and 0093 were read as summaries and cited clauses, not in full. The owner has accepted the Status change on that basis.
- **Batch gate.** The full `npm test` and the full `npm run test:workers` have not run. They are the once-per-batch pre-merge gate under Test scope, and this issue does not run them.

**Commands and counts** (`C:\AI2026\chat-marketplace-03d`, each prefixed `env -u LLM_API_KEY`), after the change:
1. `npm run check`: exit 0.
2. `npx tsx --test test/assistant-task-lanes.test.ts`: tests 8, pass 8, fail 0, skipped 0.
3. `npx tsx --test test/assistant-cold-journey.test.ts test/agent-mode-shell.test.ts`: tests 13, pass 13, fail 0, skipped 0.
4. `npx tsx --test test/agent-mode-follows-task.test.ts`: tests 10, pass 10, fail 0, skipped 0.
5. `npx tsx --test test/assistant-task-persistence.test.ts`: tests 10, pass 10, fail 0, skipped 0.

**Definition of Done (final).** Items 1 to 6 are met, with the reading-scope note for item 3. Item 5 is met: `DEFAULT_LANE_TIMELINE_CAP` is owner decision O3, the bounds 2 to 1000 are engineering bounds, and the two copy strings are accepted. Item 7: `npm run check` is clean, and the batch-gate `npm test` has not run (per Test scope, once per batch). Status is set to `resolved` on that basis.
