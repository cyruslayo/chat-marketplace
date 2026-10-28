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

### Implementation (28 Oct 2026, branch `integration/concierge-controls`, base d60f82b)

Status left `ready-for-agent`. The full `npm test` item of the Definition of Done is open for the batch gate, and `npm test` and `npm run test:workers` were not run here (Test scope). Commits: `fa8e064` (transaction), `360c8d0` (projection handlers), `c6d7928` (confirmation handlers), and the tests and this record in the step-4 commit.

**ADR discovery and table.** Listed `docs/adr/` and read every ADR the issue names (0099, 0003, 0074, 0070, 0072, 0075, 0080, 0041, 0105, 0081) plus 0106 in full with its 26 and 27 Oct amendments. Only the constraints that bite here are below.

| ADR | Constraint | Where it bites |
|---|---|---|
| 0099 | Packs declare; the platform names no domain; one action gate | `AssistantDomainPack.stageHandlers`; the runtime names no shortlet or commerce tool, kind or stage (boundary test); the generic authority checks run before any `confirm` |
| 0003 | Platform provides extension points; domains keep their own language | `AssistantStageHandler` is the extension point; criterion 3 test adds a stage with a fake pack and no runtime edit |
| 0074 | Fail-closed surface lifecycle; stale actions return a conflict | Each handler's `supersedes` list and its retire points are copied unchanged; the search that changes the proposed stay still removes the proposal; stale confirms still return `STALE_SURFACE` |
| 0070 | One mutating run per thread; interaction ids separate from domain ids | `TurnTransaction` holds the candidate; a rollback is "not committed"; each commit site writes the same parts as before. The in-flight resurrection (issue 06) is untouched and still open |
| 0072 | Consequential actions resolve to platform commands with confirmation tokens | Confirm handlers call the same commands with the same tokens (`conditionalOfferApp.accept`, `cardPaymentApp`, `bookingRequestApp`) |
| 0075 | Authority is scoped and expires fail closed; no bearer credentials in diagnostics | Thread, actor, tenant, expiry and already-executed checks stay in `#executePendingAction` before dispatch; `effectCode` and `turn_stop` diagnostics carry closed codes only |
| 0080 | Deterministic parity; no change to fallback routes | Failure and rollback paths unchanged (`CONCIERGE_UNAVAILABLE`, fallback copy, `tool_denial` clarification) |
| 0041, 0105 | Disclosure waits for the operator's confirmation; the staging demo exception | Copied unchanged into `requestToBookHandler` (`environment.config.production && demoRequestAcceptor?.delaySeconds !== 0`) |
| 0081 | Weaver behind platform boundaries; A2UI from authoritative projections | Pack surface builders are called unchanged; no framework type enters the runtime or the handler module |
| 0106 | Closed outcomes; no new control outcome; one `turn_stop` per planner turn | `replyControlOutcome` and `effectCode` are pack hooks that return existing codes; `turn_stop` emission unchanged |

**Final shape of the interface** (`apps/local-guest/src/assistant/assistant-stage-handler.ts`). It differs from the issue's sketch in three deliberate ways:

```ts
interface AssistantStageHandler {
  readonly stage: string;
  readonly supersedes: readonly string[];
  project?(input: { toolName; args; execution }, turn: StageTurnContext): StageProjection | undefined;
  readonly confirms?: string;                       // the pending-action kind this handler confirms
  confirm?(action: PendingAssistantAction, turn: StageTurnContext): PendingActionOutcome;
}
interface StageTurnContext { threadId; tx: TurnTransaction; pack; environment; setStage(stage): void }
interface StageProjection { surface?: AssistantTurnSurface; fallbackMessage?: string }
```

1. `project` receives the tool name and arguments. A handler claims an execution by its tool name, because one shortlet tool (`get_unit_details` with an unknown stay) claims and places nothing. `undefined` means "not mine".
2. A handler retires its own `supersedes` by calling `retireOwnStages(handler, turn)` at the point its behaviour requires. The runtime does not apply the list. The reason: the discovery search retires before it can throw, and `get_unit_details` retires only when it finds the stay, so an upfront generic rule would change behaviour.
3. `confirm` is found by `confirms` kind after the runtime's authority checks. An unknown kind still returns `UNSUPPORTED_ACTION`.

**Files now.**
- `assistant-turn-transaction.ts` (new): `TurnTransaction` (`supersede`, `place`, `clearPendingAction`, `addSurface`, `commit(thread, parts)`, `fallbackMessage`) and `syncActiveTask`.
- `assistant-stage-handler.ts` (new): the interface, `StageTurnContext`, `PendingActionOutcome`, `retireOwnStages`, `PENDING_ACTION_STAGE`.
- `shortlet-stage-handlers.ts` (new): discovery, unit, request draft (projection) and request_to_book, accept_offer, start_checkout (confirm), with `SHORTLET_STAGE_HANDLERS` and `proposalStillAuthorised`.
- `assistant-runtime.ts`: the if-chain and the confirm switch are gone. It keeps the tool loop, router, task tools, the generic pending card and projected-surface paths, the transaction commit sites, and the authority checks. `ASSISTANT_CONTROL_OUTCOMES` and `AssistantToolEffectCode` moved to `assistant-platform.ts` and are re-exported unchanged.
- `assistant-platform.ts`: `stageHandlers`, `replyControlOutcome`, `effectCode` added to the pack and result types.
- `shortlet-assistant-pack.ts`: `stageHandlers: SHORTLET_STAGE_HANDLERS`, `replyControlOutcome` (no active booking), and `effectCode` on the request-draft result.
- Tests (new): `test/assistant-stage-handlers.test.ts` (6 tests) and `test/assistant-runtime-boundary.test.ts` (1 test).

**Behaviour checks made while moving code.**
- Commerce's platform action gate: the `activeTask?.domain !== "commerce"` check is replaced by `!activeTask`. `actionPack` is `packFor(activeTask.domain)`, so `pack.id === domain` always holds. The only pack with `platformActionNames` is commerce, so the result is the same.
- The fallback copy: was chosen by a surface-id substring in `fallbackForProjectedOperation`. It is now the first surface's handler message. Shortlet ids all carry their stage (`:discovery:`, `:unit:`, `:request:draft:`), and commerce ids use `commerce-discovery:` (no `:discovery:` substring), so the copy is the same.
- The request-draft `effectCode` used to be computed from the tool name plus the result. It is now set by the pack that returns exactly that result, so the same events are emitted.

**Acceptance criteria.**
1. Recorded journeys and evals pass unchanged. No expected value or recording was edited. Met (see counts).
2. Runtime names no shortlet or commerce tool, kind or stage. Test `assistant-runtime-boundary.test.ts`, "assistant-runtime.ts contains no shortlet or commerce tool names, pending-action kinds or stage names". Met, with the exception in decision (b).
3. A new pack adds a stage with its own surface and supersede rule without editing the runtime. Test "criterion 3: ...". Met. The fake pack builds on `createFakeShopPack` from `test/helpers/fake-domain-pack.ts`.
4. Wrong thread, actor, tenant or expiry, or already executed, is refused before any `confirm`. Test "criterion 4: ...". Met. It asserts `STALE_SURFACE`, no handler call, and the proposal still in place. A matching action reaches the handler once.
5. Failure with no successful operation leaves the thread unchanged. Test "criterion 5: ... no application operation succeeded". Met. Failure after a success keeps the projected state and the fallback copy. Test "criterion 5: ... an application operation succeeded". Met.
6. Each shortlet supersede rule is declared once and matches today's rules. Test "criterion 6: ...", which checks the six handlers' stage, `supersedes` and `confirms`. Met. The one conditional retirement (the pending card, when a search changes the proposed stay) stays inside the discovery handler's code, as the rule requires.

**Definition of Done (docs/agents/issue-tracker.md).**
1. Named test per criterion: met. Each `test()` covers one criterion or one failure case of it.
2. Failure paths: met. Criterion 4 asserts `STALE_SURFACE` for each mismatch and that no handler ran. Criterion 5 asserts `CONCIERGE_UNAVAILABLE` and an unchanged thread, and the fallback path with its kept surfaces.
3. ADRs listed and read: met (table above).
4. No unused injected dependency: met. Every `TurnTransaction` method and `StageTurnContext` field is used by a handler or a commit site. `retireOwnStages` is called from every handler that declares `supersedes`.
5. No invented policy: met. Every copy string and the fallback texts moved unchanged from the runtime. No new constant.
6. No bearer credential in logs: met. No new diagnostic field; `effectCode` and `turn_stop` are closed codes.
7. `npm run check` passes: met (exit 0, final run). `npm test` passes with zero failures: open for the batch gate.

**Commands and counts** (run as `env -u LLM_API_KEY ...`; safety list = the issue's named recorded-journey, cold-restore, stop, tool-argument, pending-action, proposal, where-chip, artifact, booking, evals and control-metrics files; extra list = pack-registry, task-rail, search-unknowns, demo-extended, context-isolation, reply-plan-references, tool-authorization, control-outcome-count, date-literal-authority, scope-controls).

- Baseline on `d60f82b` (before any change): safety list `node --import tsx --test <safety>`: 169 tests, 167 pass, 2 fail. The two failures are pre-existing and not caused by this work: `assistant-tool-argument-validation.test.ts`, "a switch_task call with a numeric taskId ..." and "a start_task call without its required domain ...". Both expect no `replacedPendingAction` key in the task state, and HEAD adds one. Not edited, not fixed; see decision (e).
- After step 1 (`fa8e064`) and step 2 (`360c8d0`) and step 3 (`c6d7928`): `npm run check` exit 0; safety list 169 / 167 / 2 (same two failures); extra list 82 / 82; `npm run test:assistant` 67 / 67.
- Final (after step 4, this commit): `npm run check` exit 0; safety list plus `assistant-stage-handlers.test.ts` (6/6) and `assistant-runtime-boundary.test.ts` (1/1): 176 tests, 174 pass, 2 fail (the same two pre-existing failures); extra list 82 / 82; `npm run test:assistant` 67 / 67.
- Not run: full `npm test` and `npm run test:workers` (batch gate). Cold restore before each event: the safety list covers `assistant-cold-journey`, `assistant-turn-stop-cold-restore` and `assistant-pending-action-restore`; the new stage-handler tests run on one runtime, which is the same as before this refactor.

**Decisions for the owner.**
- (a) **Commerce has no stage-handler objects.** The issue asks for "commerce handlers". The projected-surface path is still the platform's generic path, which files `projectedSurface` under `${pack.id}:${kind}` (the same key as before, `commerce:${kind}`). This is the "generic path" the issue describes, so I did not add handler objects for commerce. Confirm if you want commerce to supply handlers.
- (b) **The runtime still has the Shortlet public API.** `restoreShortletState`, `recordGuestStay`, `recordGuestArea`, `selectShortletUnit`, `clearShortletSelection` and `applyDiscoveryShortlist` stay on `AssistantRuntime`, because `shortlet-app.ts` calls them. The runtime still imports `createShortletAssistantPack`, `validatedCheckOutForNights` and `proposalStillAuthorised`, and `restoreShortletState` compares the domain to the literal `"shortlet"`. The boundary test checks tool names, kinds and stage names, which is what the criterion asks for. Moving these needs a change to `shortlet-app.ts`. Deferred; please say if you want it in this issue.
- (c) **The pending confirmation card stays platform-generic.** Its projection (`replacedPendingAction` reset, the `pending_action` stage, `pack.pendingActionSurface`) runs in the runtime after the handlers, not in a handler.
- (d) **The in-flight resurrection (issue 06) is untouched.** The transaction still commits a whole clone, as before.
- (e) **Pre-existing failures on HEAD.** The two `assistant-tool-argument-validation` tests listed above. Please decide whether the expected value or the state shape is the one to fix (issue 01's test or the `replacedPendingAction` default). I did not change either.
