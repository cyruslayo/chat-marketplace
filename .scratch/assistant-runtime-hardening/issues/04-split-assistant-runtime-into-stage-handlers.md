# Split `assistant-runtime.ts` into one handler per stage behind a small shared interface

Status: ready-for-agent
Type: task
Blocked by: 01, 02, 03
Requested: 25 Oct 2026
PRD: `../PRD.md`

## Why

`apps/local-guest/src/assistant/assistant-runtime.ts` is 1,206 lines. One class does five jobs: the turn transaction, the model/tool loop, the cross-domain router, surface placement for every stage, and execution of every confirmed action. Measured on `main` at a5b4250:

- **Shortlet logic sits in the platform runtime.** The tool loop branches on shortlet tool names (`search_stays`, `get_unit_details`, around lines 499–534). `#executePendingAction` (lines 846–1140) switches on shortlet action kinds (`request_to_book`, `accept_offer`, `start_checkout`). Commerce, added later, already uses a generic path: the pack returns `projectedSurface` and the runtime files it under `commerce:${kind}`. Shortlet should use the same path. This is the module boundary ADR 0099 asks for.
- **Seven stage constants** (`DISCOVERY_STAGE` … `BOOKING_STAGE`) and their supersede rules are spread across `handleTurn`, `handleAssistantEvent` and `#executePendingAction`. Which stage supersedes which is not written down in one place.
- **The turn transaction is copied by hand.** Nine `candidate*` variables are cloned at the start of `handleTurn`, and the same nine-line commit block appears twice (success, and the projected-operation fallback). `candidateTaskState.pendingAction = null` appears more than ten times.

An agent framework would sell this as a "graph". The repo needs the structure, not the dependency.

## What to build

Behaviour does not change. Split along these seams:

1. **`TurnTransaction`** (new module): holds the candidate thread state, `supersede(stage)`, `place(stage, surface)`, `clearPendingAction()`, `commit()`. Rollback is "don't commit". Both commit sites in `handleTurn`, and `handleAssistantEvent`, use it.
2. **`AssistantStageHandler`**: the small shared interface. Starting sketch; the implementer may refine it, but must keep it small and must record the final shape in Comments:
   ```ts
   interface AssistantStageHandler {
     readonly stage: string;                    // "discovery", "unit", "request", "commerce:cart", ...
     readonly supersedes: readonly string[];    // stages whose active surface this one replaces
     /** Turns an authoritative tool execution into this stage's surface, or undefined if it does not apply. */
     project(execution: AssistantToolExecutionResult, turn: StageTurnContext): AssistantTurnSurface | undefined;
     /** Executes a confirmed pending action of a kind this stage owns. */
     confirm?(action: PendingAssistantAction, turn: StageTurnContext): PendingActionOutcome;
   }
   ```
3. **Packs supply their handlers.** `AssistantDomainPack` gains `stageHandlers`. The shortlet handlers (discovery, unit, request, pending action, offer, payment, booking) move to a new `shortlet-stage-handlers.ts` beside `shortlet-assistant-pack.ts`; commerce's existing `projectedSurface` path becomes commerce handlers. The supersede rules become the `supersedes` lists, in one place per pack.
4. **What stays in the runtime:** the tool loop, the router, platform task tools, the turn transaction, and the generic pending-action authority checks that run before any `confirm` (thread, actor, tenant, expiry, already-executed; ADR 0070/0074/0075). Those checks stay in the runtime so no pack can skip them.
5. **The runtime names no domain.** After the split, `assistant-runtime.ts` contains no shortlet or commerce tool names, action kinds or stage names. Add a test that fails if it does, in the style of the existing domain boundary test (multi-domain-platform issue 06).

Do it in reviewable commits (transaction first, then handlers per stage), with issue 03's recorded journeys and the existing evals passing after each.

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0099 | Domain-pack interface and module boundaries | Shortlet stage logic moves into the shortlet pack; platform names no domain |
| 0003 | Platform provides extension points; domains keep their own language | `AssistantStageHandler` is the extension point |
| 0074 | Fail-closed surface lifecycle; stale actions return a conflict | `supersedes` rules and stale-action results unchanged |
| 0070 | One mutating run per thread; interaction ids separate from domain ids | `TurnTransaction` commits once per run |
| 0072 | Consequential actions resolve to platform commands with confirmation tokens | `confirm` handlers keep calling the same commands with the same tokens |
| 0075 | Authority is scoped and expires fail closed | Generic authority checks stay in the runtime, before `confirm` |
| 0080 | Deterministic parity for critical workflows | No change to fallback routes |
| 0041, 0105 | Disclosure waits for an Operator's real confirmation; staging demo exception | Carried unchanged into the offer handler (see the comment near line 926) |

## Acceptance criteria

1. Every recorded journey from issue 03 and every existing assistant eval passes unchanged after the split.
2. `assistant-runtime.ts` contains no shortlet or commerce tool names, pending-action kinds or stage names, enforced by a test.
3. A new domain pack can add a stage with its own surface and supersede rules without editing `assistant-runtime.ts` (shown with `test/helpers/fake-domain-pack.ts`).
4. A pending action whose thread, actor, tenant or expiry does not match is refused before any stage handler's `confirm` runs.
5. A tool or provider failure mid-turn leaves the thread unchanged when no application operation succeeded, and keeps the projected state when one did (today's behaviour, now through `TurnTransaction`).
6. Each stage's supersede rule is declared once, in its handler, and a test checks the shortlet rules match today's (search supersedes discovery and unit; request supersedes discovery, unit and request; and so on).

## Tests

New: `test/assistant-stage-handlers.test.ts`, `test/assistant-runtime-boundary.test.ts`. Affected: `npm run test:assistant`, `test/assistant-recorded-journeys.test.ts`, `test/assistant-pack-registry.test.ts`, `test/assistant-task-rail.test.ts`, `test/assistant-search-unknowns.test.ts`, `test/demo-extended-assistant.test.ts`. The guest chat real-Chrome tests do not need to run per issue; the pre-merge gate covers them.

## Comments
