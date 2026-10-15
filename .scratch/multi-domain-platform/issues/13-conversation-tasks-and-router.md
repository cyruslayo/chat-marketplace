# Conversation tasks and router: one domain per task, no silent switching

Status: resolved
Type: task
Blocked by: 12
Requested: 14 Oct 2026
Unlocks: 17, 23, 26
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

A conversation must hold flows from several domains without mixing their state or tools (PRD, Chat UX model).

## What to build

1. Generalize `apps/local-guest/src/assistant/assistant-state.ts` to `{ domain, taskId, state }` and let a thread (`packages/platform-core/src/thread.ts`) hold several tasks with one active.
2. Add a router step before the model: explicit chip/active task wins; otherwise the model classifies; a different-domain intent returns a confirmation chip ("Start a Shop search? Your stay search is saved.") instead of switching.
3. Add platform tools `start_task` and `switch_task`.
4. With only shortlet registered, behaviour is unchanged.

## Out of scope

- Task rail UI (26). Persistence across DOs (17).

## Acceptance criteria

- AC1: With one pack registered, every existing conversation test passes unchanged.
- AC2: An intent for another registered domain produces a confirmation, never a silent task switch.
- AC3: Switching tasks restores the previous task's state and tool set.
- AC4: Tools from a non-active task's domain are rejected.

## Tests

Router tests with a fake second pack in `test/helpers/` (shared fixture, not copy-pasted).

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0070-separate-interaction-and-domain-identities.md` | Task and domain identities stay separate. |
| `docs/adr/0071-synchronize-redacted-interaction-projections.md` | Per-task projections stay redacted. |
| `docs/adr/0080-retain-deterministic-parity-for-critical-workflows.md` | Router has a deterministic path. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Answer

Landed:
- `assistant-state.ts` — `AssistantTask { taskId, domain, state }`; `AssistantThreadState` now holds `tasks` and `activeTaskId`, with `taskState` mirroring the active task.
- `assistant-platform.ts` — packs declare `intentKeywords`; `PLATFORM_TASK_TOOLS` (`start_task`, `switch_task`); the registry gains `size`/`ids`/`packFor`.
- `shortlet-assistant-pack.ts` — shortlet `intentKeywords`.
- `assistant-runtime.ts` — registers extra packs via `options.additionalPacks`; the active task decides the active pack (prompt, tools, projections); a router step before the model asks for confirmation on a cross-domain intent; `start_task`/`switch_task` save the previous task's state and restore the target's; tools are drawn only from the active pack, so a tool from a non-active task's domain is rejected before execution.
- With one pack registered there is no router and no platform task tools, so behaviour is unchanged.

Tests:
- `test/conversation-router.test.ts` — AC2 "an intent for another registered domain produces a confirmation, never a silent task switch"; AC3 "switching tasks restores the previous task's state and tool set"; AC4 "a tool from a non-active task's domain is rejected". Uses the shared `test/helpers/fake-domain-pack.ts` second pack.
- AC1 "With one pack registered, every existing conversation test passes unchanged" — the scripted-assistant, Gemini/OpenAI-compatible and deterministic-concierge suites pass unchanged.

Verification: `npm run check` clean. `npm run test:non-browser` phase 1: 1757 pass / 4 pre-existing failures (see slice 06).

## Comments

- 14 Oct 2026 (agent): The slice suggested generalizing `packages/platform-core/src/thread.ts`. The assistant's working state is app-level (`AssistantThreadState`) and the interaction thread in platform-core carries audit/lease identity, not assistant working state; the task model was generalized on `AssistantThreadState` and the active pack, keeping ADR 0070's separation of domain and task identity. Persisting tasks in the platform DO is slice 17.
