# Suggest a mode switch when a turn leaves the active agent's scope (tier C only)

Status: resolved
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

16 Nov 2026 — implementation on `feat/agent-modes-03f` (baseline `81367ed`). O6 copy is `I can help with that as Concierge · {label}. Your stay details are saved.` and `Switch to Concierge · {label}`, sourced only from `guest-content.ts`. O8: the commerce-off negative regex adds this suggestion text; the commerce-on test explicitly proves classifier invocation, and the router AC2 now asserts no suggestion for an in-scope turn. No commerce production code or recorded fixture was changed.

| ADR read | Constraint verified in the implementation | AC / path |
| --- | --- | --- |
| 0073, 0074, 0080 | Existing platform task event is the only switching authority; suggestion leaves pending action and surfaces intact | AC4, AC10; `assistant-runtime.ts`, `client.ts` |
| 0075, 0079 | Diagnostic contains only registry-closed domain ids, closed reason/tier and boolean, never guest text or credentials | AC7; `#recordModeSuggestion` |
| 0076, 0107 | Suggested response drives `suggesting`; human state remains absorbing; A/B remain disabled | AC5, AC8–9; `agent-mark-state.ts`, `mode-switch-tier.ts` |
| 0077, 0078 | Single guest-content copy source; native kit chip and 44×44 CSS target at 320px through desktop | AC3, AC9; `guest-content.ts`, `client.ts` |
| 0092, 0093 | Existing guest stay context and anonymous guest authority persist, including cold restores | AC3–4, AC8, AC10; no new identity/booking authority |
| 0099, 0101, 0104 | Platform registry provides the closed target list; a parked pack cannot be targeted | AC1–3; `scope-classifier.ts`, `assistant-runtime.ts` |
| 0106 | Advisory classifier sees ids and scope descriptions only, schema enum per call; no keyword router or rejected message history | AC1–3, AC6; `scope-classifier.ts`, `assistant-runtime.ts` |

Verification (commands below were executed with the mandated `env -u LLM_API_KEY` prefix, using local `tsx`):

- `npm run check` — passed, zero type errors and Worker bundle guard passed.
- `node node_modules/tsx/dist/cli.mjs --test --test-reporter=dot test/mode-suggestion-tier-c.test.ts test/conversation-router.test.ts test/agent-mark-shell.test.ts test/agent-mode-shell.test.ts test/scope-classifier-malformed-shapes.test.ts test/assistant-cold-journey.test.ts` — 57 passed, zero failed (before final AC8 cold-restore test adjustment; own file rerun below).
- `node node_modules/tsx/dist/cli.mjs --test --test-reporter=dot test/mode-suggestion-tier-c.test.ts` — 10 passed, zero failed after AC8 adjustment.
- `node node_modules/tsx/dist/cli.mjs --test --test-reporter=dot test/commerce-agent-tools.test.ts test/pilot-commerce-off.test.ts` — 19 passed, zero failed.
- `node node_modules/tsx/dist/cli.mjs --test --test-reporter=dot test/assistant-scope-controls.test.ts test/assistant-clarification-chips.test.ts test/assistant-persistent-continuity.test.ts test/agent-mode-follows-task.test.ts` — 65 passed, zero failed.
- `npm run build` — passed; rebuilt `dist/client.js` for the real browser.
- `node node_modules/tsx/dist/cli.mjs --test --test-reporter=dot test/agent-mark-chromium.test.ts` — 5 passed, zero failed, one browser file at a time. Captures saved locally in `screenshots/03f/` for 320, 390, 768 and 1280; no horizontal overflow and target at least 44×44 at each viewport.
- `node node_modules/tsx/dist/cli.mjs --test --test-reporter=dot test/assistant-recorded-journeys.test.ts test/assistant-task-lanes.test.ts` — 11 passed, 2 failed: replay diverges on the first classifier request because the immutable recorded fixture carries the old request schema/context. Issue Verification requires owner approval before re-recording; none was provided. Fixture untouched. This blocks the issue's affected-test and DoD gate.
- `git diff --check` — passed (Windows LF/CRLF notices only).

Definition of Done review: (1) ten dedicated tests named AC1–AC10: yes; (2) named fail-closed paths covered, including unknown target, unclear/failure, in-scope keyword, unchanged task and guest event: yes; (3) relevant ADRs listed, read and checked above: yes; (4) no new unused dependency injection: yes; (5) copy and tier setting sourced from O6 and ADR 0107: yes; (6) no identity, text or credential in diagnostic: yes; (7) `npm run check` clean, but affected recorded-replay tests blocked on explicit fixture approval; full `npm test` / Workers are the parent's once-per-batch gate. **Keep open until the owner authorizes a fixture re-record and the affected replay tests pass.**

17 Nov 2026 — orchestrator (review-defect fixes, fixture re-record, resolution). Two defects found by the independent review were fixed tests-first, on top of commit 07122c7:

1. **The suggestion chip is lost on reload.** `AssistantRuntime.restoredModeSuggestion` reconstructs the suggestion on `getState` only from the active lane's last server-authored message, only when it exactly matches the O6 suggestion copy for exactly one registered pack other than the active one (duplicate labels fail closed), and only while that pack stays registered. The restored payload is advisory only (`undoable: false`); a stored message grants no switching authority — accepting still requires the validated `platform.task.start` event (ADR 0074, 0107). `GuestStateSnapshot` carries `quickReplies`/`modeChange` for the restore; `client.ts` renders the chip and the suggesting mark on restore. Red→green: at committed 07122c7 with only the new tests copied in, `mode-suggestion-tier-c` AC1 and AC10 fail; they pass with the fix. Fail-closed paths asserted: ambiguous duplicate labels, a pack removed from the registry, an accepted suggestion not resurrected in another lane.
2. **A quick second task action could remove the chip before its event was sent.** The chip's click handler now refuses while a task event is in flight (`isLoading || (reply.domain !== undefined && taskEventInFlight)`): a concurrent task event would be ignored by `sendTaskEvent`, so the guest choice is not consumed first (ADR 0074). Red→green: at committed 07122c7, the new `agent-mark-chromium` AC10 fails ("no optimistic user turn during another task event", "the suggestion stays actionable after the busy event"); it passes with the fix.

**Recorded-journey fixture re-record (owner approved, 16 Nov 2026).** All five fixtures under `test/fixtures/assistant-recordings/` were stale: the classifier request gained the registered-packs context and the per-call `targetPack` schema, and the verdicts gained `targetPack`. Re-recorded with `node --import tsx scripts/record-assistant-journey.ts` (offline scripted model; no fixture was edited by hand). For four journeys the `turns` payloads are byte-identical to before; only the exchange request/response shape changed, and each replays faithfully.

**`confirm-after-task-switch` redesign (owner decision, 17 Nov 2026).** The old recording's turn 3 was the keyword-route artifact this issue deletes (`Start a Shop search?...` removed the proposal while keeping the stays lane active), which was the only way turn 4's typed "Yes" could reach the lane-scoped replaced notice. With a real `start_task` switch the guest lands in the shop lane, where the stays notice is not there: the typed "Yes" sends nothing (ok, no request or pending surface, runtime-generic reply, `rejected_plan_fallback`), and the old card's button is still refused `STALE_SURFACE`. Deliberate test-expectation changes, recorded here like the O8 changes: `test/helpers/assistant-recordings.ts` (new `nothingSent` intended-outcome flag; `replyAfter` answers a `start_task` result with the structured `redirect` form the runtime accepts — plain text is rejected as `not_json`; `normaliseGeneratedIds` also normalises task ids, which are runtime-minted UUIDs), `test/assistant-recorded-journeys.test.ts` (the `afterSwitch` block pins turns 3 and 4 to the real-switch reality; `confirm-after-search-change` keeps `replaced` and its unchanged copy), and `test/assistant-proposal-replacement.test.ts` scenario (c) (same reality for the typed yes after a switch; STALE_SURFACE unchanged). The pinned copy is the runtime's own fallback string (`assistant-runtime.ts:1402/1610`), not new copy.

**Environment note (not a code regression).** The machine environment has `NODE_ENV` set, which makes `loadPaystackConfiguration` take the production branch and throw `PAYSTACK_SECRET_KEY is required` in server-starting tests. All test commands were run with `env -u LLM_API_KEY -u NODE_ENV`; the batch gate must do the same.

Verification (all with `env -u LLM_API_KEY -u NODE_ENV`, local `tsx`):

- Red checks (detached worktree at 07122c7, only the new test files copied in): `node node_modules/tsx/dist/cli.mjs --test test/mode-suggestion-tier-c.test.ts` — AC1 and AC10 fail (red); the same for `test/agent-mark-chromium.test.ts` after `npm run build` — AC10 fails (red). Both green with the fixes in place.
- `npm run check` — clean (zero type errors, Worker bundle guard passed).
- `node node_modules/tsx/dist/cli.mjs --test test/mode-suggestion-tier-c.test.ts test/conversation-router.test.ts test/agent-mark-shell.test.ts test/agent-mode-shell.test.ts test/scope-classifier-malformed-shapes.test.ts test/assistant-cold-journey.test.ts test/commerce-agent-tools.test.ts test/pilot-commerce-off.test.ts test/assistant-scope-controls.test.ts test/assistant-clarification-chips.test.ts test/assistant-persistent-continuity.test.ts test/agent-mode-follows-task.test.ts test/assistant-task-lanes.test.ts test/assistant-recorded-journeys.test.ts` — **154 passed, 0 failed** (assistant runtime enabled, cold restore before every event, clock 2026-10-27, staging-like guest with no seeded phone or email).
- Collateral (helper consumers): `node node_modules/tsx/dist/cli.mjs --test test/assistant-proposal-supersession.test.ts test/assistant-proposal-replacement.test.ts test/assistant-task-lanes.test.ts test/assistant-where-chip.test.ts test/assistant-budget-chip.test.ts test/assistant-budget-phrase.test.ts test/assistant-pending-action-restore.test.ts test/assistant-thread-lock.test.ts test/assistant-recording-clients.test.ts` — **111 passed, 0 failed**.
- `npm run build` — passed; rebuilt `dist/client.js` for the real browser.
- Real Chrome, solo: `node node_modules/tsx/dist/cli.mjs --test test/agent-mark-chromium.test.ts` — **6 passed, 0 failed** (AC9, new AC10, AC3, AC4, AC5, AC7). Captures for 320/390/768/1280 light and dark are in the untracked `screenshots/03f/`: no horizontal overflow, no control under 44px.
- `grep -rn '#route' apps/local-guest/src/` — no matches (keyword router gone). Commerce pack, `guest-content.ts` and `domains/shortlet` untouched by the follow-up work.

Definition of Done re-review after the follow-up: (1) AC1–AC10 each have their dedicated named test, plus the two review-defect additions (chromium AC10; restore and duplicate-label assertions inside tier-c AC1/AC10): yes; (2) fail-closed paths asserted (unknown target, duplicate labels, unregistered target, busy task event, unclear/failure, in-scope keyword, unchanged task, stale button): yes; (3) ADRs re-checked — the restore grants no authority (0074, 0106, 0107), diagnostics stay closed (0075, 0079), copy from one source (0077), 44px target (0078), commerce parked (0104): yes; (4) no unused injection: yes; (5) no invented policy string — the pinned fallback copy is the runtime's existing string: yes; (6) no credential or identity in diagnostics or fixtures (the recorder's credential scan passed): yes; (7) `npm run check` clean and the issue's own and affected tests green; full `npm test` and `npm run test:workers` are the once-per-batch gate, run in the dedicated gate worktree before any merge to main. **Resolved; batch gate pending.**
