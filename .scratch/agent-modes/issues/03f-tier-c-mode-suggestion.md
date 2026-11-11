# Suggest a mode switch when a turn leaves the active agent's scope (tier C only)

Status: ready-for-agent
Type: task (behaviour change; an intended change to one existing test assertion, see AC10)
Blocked by: 03a (`atRisk`, closed scope facts), 03c (mode from the active task), 03d (lanes, so a suggestion can point at an existing lane). Open decision O6 (suggestion copy and whether tiers A and B are enabled). Owner release as in 03a (ADR 0107 "Settled", 8 Nov 2026).
Requested: 10 Nov 2026

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 9.4 (tiers) and 5.7 ("Cross-domain routing"); [ADR 0107](../../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md) decision 8 (tier C only until thresholds are tuned; no keyword match decides a switch); [map](../map.md) slice 4b (part 1).

## Why

The router today is a keyword match. `#route` (`apps/local-guest/src/assistant/assistant-runtime.ts:627` to `:640`) returns a fixed message when a turn's text contains another pack's `intentKeywords`. It runs before the classifier when more than one pack is registered (called at `:1065`). It is not a switch: it asks the guest to start a search. But ADR 0106 says there is no deterministic in-scope fast path, and ADR 0107 decision 8 says a switch never starts from a keyword match. The keyword list is also the only use of `intentKeywords` (`assistant-runtime.ts:630` and `:634`).

The scope classifier (`apps/local-guest/src/assistant/scope-classifier.ts`) already judges every turn, with a closed `scope` enum (`in_scope`, `mixed`, `out_of_scope`, `unclear`) and no target pack. This issue adds a closed target field to the verdict and uses it to offer a suggestion. It never switches on its own, because A and B are off (ADR 0107 decision 8).

Known tests that will change on purpose: `test/conversation-router.test.ts` AC2 (asserts the keyword message `Start a Shop search? Your shortlet search is saved.`), `test/commerce-agent-tools.test.ts:105` and `test/pilot-commerce-off.test.ts:172` (assert the `Start a Commerce search` text; commerce is parked, ADR 0104), and `test/agent-mark-shell.test.ts` AC2 (see step 9).

## What to build

1. **Closed target enum.** The scope verdict gains `targetPack: string | null`. The schema's `enum` is built per call from the ids of the registered packs (not a constant), so an id outside the registry is refused. Anything else becomes `null`.
2. **Classifier input.** The classifier receives the registered packs' ids and their `scopeDescription` lines. It receives no tool list and no pack prompt (ADR 0106 "Scope").
3. **Tier selection.** A pure function `modeSwitchTier({ scope, targetPack, packAtRisk, tiersEnabled })` returns `none`, `C` or `B`/`A`. Only tier C is enabled. The set of enabled tiers is a named configuration constant, not a literal in the domain code (AGENTS.md anti-pattern 3). A and B are represented and tested, but disabled.
4. **Suggestion, not switch.** When a verdict is out of scope for the active pack, names a registered target, and the tier is C, the response carries `modeChange: { from, to, reason: "suggested", undoable: false }` and one suggestion chip. The chip's copy comes from `guest-content.ts` with the target's label (copy is open decision O6). The active task does not change, and its pending proposal is not dropped.
5. **Accepting.** A chip tap sends the existing `platform.task.start` (or `platform.task.switch` when the target has a task). Nothing new grants authority (ADR 0074, 0106).
6. **Uncertain verdict.** An `unclear` scope with a target, a classifier failure, or a `null` target gives no suggestion. The existing fixed copy and `scope_redirect` path apply.
7. **Remove the keyword router.** Delete `#route` and its call at `assistant-runtime.ts:1063` to `:1069`. The `intentKeywords` field stays in the pack type for now, unused by routing; removing it is a later cleanup.
8. **Diagnostic.** Emit closed `assistant.mode.change.v1` through the same telemetry path as `assistant.control.outcome.v1` (`assistant-runtime.ts:1544`), with `from`, `to` (closed pack ids), `reason`, `tier`, `undone: false`. No ids, no text, no tokens (ADR 0075, 0079).
9. **Mark.** A `modeChange.reason === "suggested"` response drives the Agent Mark to `suggesting`, as ADR 0107 decision 9 describes. `switching` stays unproduced. Update `test/agent-mark-shell.test.ts` AC2 deliberately: `suggesting` is now reachable only through a suggested response, and the test says so. `human`, `working` and `switching` stay unproduced.
10. **Tests named for the old behaviour.** `conversation-router.test.ts` AC2, `commerce-agent-tools.test.ts:105` and `pilot-commerce-off.test.ts:172` change their expected text to the suggestion copy, and each change is recorded in Comments with the reason.

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0106 "Scope" | The verdict is advisory. Closed reason codes. No freeform text from the classifier. Perimeter checks before classification. | Steps 1 to 3. |
| 0106 "Scope" and ADR 0106 resource controls | No deterministic in-scope fast path. Each classifier call reserves model capacity. | Step 7 removes the keyword path; AC2. |
| 0106 "Tools and context" | Rejected turns do not re-enter history. | Suggestion turns are not added to the other lane's history. |
| 0107 decision 8 | Tier C only until thresholds are tuned. Uncertain falls to C. No automatic switch on a keyword. One automatic switch per turn at most. No switch back after a manual choice. | Steps 3, 4 and 6; AC3, AC6 and AC8. |
| 0107 decision 9 | `suggesting` is a mark state from a signal the shell already has. | Step 9. |
| 0074 | Switching supersedes proposals. A suggestion does not switch, so it does not drop a proposal. | AC4. |
| 0075, 0079 | Closed diagnostics without ids. | Step 8; AC7. |
| 0077 | Copy comes from one source. | Step 4. |
| 0078 | The chip is at least 44 by 44 CSS pixels. | Step 4; AC9. |
| 0104 | Commerce stays parked. Parked packs are not registered and get no suggestion. | Tests in step 10 stay on the stays and fake-shop packs. |

## Acceptance criteria

Each is its own `test()` in `test/mode-suggestion-tier-c.test.ts`.

1. A verdict whose target is not a registered pack id becomes `targetPack: null`, and the turn gets the fixed scope redirect (fail closed).
2. An in-scope turn that contains another pack's keyword (for example "shop") gets no `modeChange` and no suggestion, and no keyword match runs.
3. An out-of-scope turn with a valid target and the tier-C setting gets `modeChange.reason === "suggested"`, one chip, and the active task id is unchanged.
4. With an open proposal (`atRisk` true), the suggestion keeps the pending proposal: it is still present after the turn.
5. With A and B disabled, a turn whose pack is not at risk still gets a suggestion, not a switch. `modeSwitchTier` returns the disabled tier only when the setting enables it (unit-tested with an injected setting).
6. An `unclear` verdict with a target, and a classifier failure, produce no suggestion and no switch.
7. `assistant.mode.change.v1` is emitted with closed fields only; the test asserts no id, text or token value appears in the payload.
8. After a guest's manual switch away from the stays task, a later out-of-scope turn produces a suggestion and not an automatic switch back.
9. The suggestion chip's touch target is at least 44 by 44 CSS pixels in the rendered shell (a DOM and CSS check; the real-browser check is in the Verification list).
10. Accepting the chip sends `platform.task.start` for the target domain, and the response's mode is the target's only after that event.

## Verification

- `env -u LLM_API_KEY npm run check`.
- Local, assistant enabled, cold restore before every event, clock 2026-10-27, staging-like guest with no seeded phone or email:
  - `env -u LLM_API_KEY npx tsx --test test/mode-suggestion-tier-c.test.ts test/conversation-router.test.ts test/agent-mark-shell.test.ts test/agent-mode-shell.test.ts test/scope-classifier-malformed-shapes.test.ts test/assistant-cold-journey.test.ts`.
  - `env -u LLM_API_KEY npx tsx --test test/commerce-agent-tools.test.ts test/pilot-commerce-off.test.ts` (text assertions changed by step 10).
- Recorded classifier fixtures: the schema gains a field, so a recorded classifier response may no longer match. Re-record only with the owner's approval, and say so in Comments. Do not edit fixtures to match.
- Real Chrome: `test/agent-mark-chromium.test.ts` runs solo, only if the suggestion chip changes the mark screen (it does), one file at a time.
- Full `npm test` and `npm run test:workers` run once per batch (Test scope), not here.
- Record commands and counts under `## Comments`.

## Out of scope

- Tiers A and B (represented, disabled). Enable only after labelled turns exist and thresholds are tuned (ADR 0107 decision 8).
- Undo chips and the "Back to Stays" control (tier A and B behaviour).
- The cross-lane hand-over of guest text (lane switch mechanics beyond what 03d provides).
- The sheet and strip (03g).
- Removing the `intentKeywords` field.

## Comments
