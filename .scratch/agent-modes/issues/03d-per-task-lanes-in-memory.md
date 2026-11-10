# Give each task its own chat lane (timeline and model history)

Status: ready-for-human
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
7. **New conversation.** "New conversation" starts a new task in the active mode and resets only the active lane. Other lanes are untouched. Verify the current reset path before editing (the button is at `guest-server.ts:359`; the reset logic was not located in the survey).
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
| 0079 | "New conversation" keeps committed work visible. | Step 7; AC5. |
| 0101 | The platform owns threads and tasks. | Lanes are platform thread state. |

## Acceptance criteria

Each is its own `test()` in `test/assistant-task-lanes.test.ts`.

1. A switch from stays to the fake shop task saves the stays timeline and restores the shop timeline (empty on first visit); switching back restores the stays timeline unchanged. A pending proposal is still dropped on the switch (ADR 0074).
2. An entry written in the stays lane is absent from the shop lane's response (context isolation; the fake shop planner context contains no stays text).
3. After a cold restore, the active lane's timeline and every persisted lane's timeline are restored, with `taskId` values unchanged.
4. After a cold restore the lane's `conversationHistory` is empty, and the stored projection has no `conversationHistory` or model text key.
5. "New conversation" in the shop lane resets the shop lane only; the stays timeline is unchanged.
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
