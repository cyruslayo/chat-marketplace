# Conversation tasks and router: one domain per task, no silent switching

Status: ready-for-agent
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

## Comments
