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

### Review follow-up (28 Oct 2026): items 1 to 6

Tests were written first where a behaviour changed. Commands run with `env -u LLM_API_KEY`.

1. **Reply control outcome across packs (behaviour restored).** `#replyControlOutcome` asks every registered pack in registry order and takes the first defined answer, as d60f82b always checked the results regardless of task. The regression test `test/assistant-reply-control-outcome.test.ts` has the reviewer's scenario: one round with `get_booking_status` (no booking) then `start_task {domain:'shop'}`, then a reply. It expects `no_current_booking`. The shortlet `no_current_booking` test is in the same file. Mutation M1 (active pack only) fails the test. Mutation M2 (shortlet hook removed) fails it too.
2. **Platform action gate per pack (ADR 0099 section 3).** The check is now `eventName.startsWith(\`${pack.id}.\`)`, plus the existing checks: the pack declares the action, has `handlePlatformAction`, and the active surface key is `${pack.id}:checkout`. `test/assistant-platform-action-gate.test.ts` covers four cases: another pack's action (`commerce.checkout.confirm`) declared by a fake pack is refused before its handler; the pack's own namespaced action runs; the pack's action on another pack's surface key is refused; and a declared action without a handler is refused. Mutation M3 (namespace check removed) fails.
3. **Boundary test with a named allowlist (criterion 2).** `test/assistant-runtime-boundary.test.ts` scans the four platform files (runtime, platform, stage-handler, turn-transaction) for: shortlet and commerce tool names; pending-action kinds; quoted stage names; quoted `"shortlet"` and `"commerce"` literals; the imports `createShortletAssistantPack`, `proposalStillAuthorised`, `validatedCheckOutForNights`; and the `${...}:` template stage key. The scan must equal the allowlist exactly, so a new match fails, and so does a stale entry. Allowlist entries with counts: runtime `"shortlet"` ×2 (restoreShortletState, follow-up issue, decision b); runtime template key ×4 (platform gate key, generic projected-surface key (decision a), pending-card surface id (ADR 0074), and the restored pending-card id in restoreShortletState (follow-up, decision b)); platform projectedSurface kind union `"discovery"` ×1 (decision a). The import entries for `createShortletAssistantPack`, `proposalStillAuthorised` and `validatedCheckOutForNights` are NOT in the allowlist: the scan found no runtime import of them... see the note below. Mutation M4 (`"shortlet"` literal added to the runtime) fails. Note: the first version of the scan omitted these import patterns, and the scan found the backslash escape wrong (a template literal turned `` into a backspace), so the imports were not enforced until this fix. Both are corrected and the allowlist is exact.

   The three import patterns (createShortletAssistantPack, proposalStillAuthorised, validatedCheckOutForNights) are enforced too, with count 2 each: createShortletAssistantPack and proposalStillAuthorised are labelled pending owner decision (issue 04 decision b); validatedCheckOutForNights is the Shortlet public API follow-up.

4. **Supersession (behaviour tests, not only evals).** Added `test/assistant-shortlet-stage-behaviour.test.ts` with three shortlet tests: a second search supersedes the first discovery surface; a unit detail call supersedes the discovery surface and places the unit surface; and the request draft's effect code. Mutation M5 (discovery handler does not retire its stages) fails the supersession test. `supersedes` is still applied by the handler (`retireOwnStages`), not automatically: the discovery search must retire before it can throw, and get_unit_details retires only when it finds the stay, so the handler owns that timing.
5. **Coverage.** Shortlet `prepare_request_draft` effect code asserted through the real diagnostic (M6 fails it). The commerce key: a pack with id `commerce` filing a projected cart surface is at `commerce:cart`, in `test/assistant-stage-handlers.test.ts` (M7 fails it).
6. **Fallback copy (intentional change).** `test/assistant-stage-handlers.test.ts`: a surface id that contains `:discovery:` no longer selects the discovery copy. The copy comes from the pack that filed the surface (the generic copy here), and the id is not read. M8 (id lookup restored) fails it. Intentional: the old id-substring lookup was fragile, and the copy is now owned by the handler.

**Approvals recorded.**
- (a) Commerce handler objects are deferred (deviation from "What to build" point 3). Commerce is not shipping (ADR 0104); the generic projected-surface path files commerce's surfaces under `commerce:<kind>`, pinned by a test in `test/assistant-stage-handlers.test.ts`.
- (c) The pending confirmation card stays in the runtime. PENDING_ACTION_STAGE is platform-owned (ADR 0074); the card is not a domain stage.

**Commands and counts (this follow-up, before the decision (b) commit).**
- `env -u LLM_API_KEY npm run check`: exit 0.
- Named list (stage-handlers 8; boundary 3; recorded-journeys; recording-clients; cold-journey; turn-stop-cold-restore; turn-stop-reasons; tool-argument-validation 13; pending-action-restore; proposal-replacement; proposal-supersession; where-chip; artifact-authority; booking-journey; shortlet-assistant-evals; control-metrics; control-outcome-count; commerce-agent-tools; reply-control-outcome 2; platform-action-gate 4; shortlet-stage-behaviour 3): 205 tests, 205 pass, 0 fail.
- `env -u LLM_API_KEY npm run test:assistant`: 67 tests, 67 pass, 0 fail.
- Mutations (each restored from backup, file bytes verified): M1 to M8 each fail their target test (exit 1).
- Not run: full `npm test`, `npm run test:workers` (batch gate).

### Owner decision (b): the host composes the packs (28 Oct 2026, separate commit after the review fixes)

**Decision.** ADR 0099 section 6: the host is the composition root. The runtime constructs no Shortlet pack, and the proposal-authority rule (ADR 0074) is a pack hook, not a Shortlet import. Owner-approved on the coordinator's instruction, with the follow-up scope below.

**What changed.**
- `AssistantRuntimeOptions.packs` (new): the host's packs; the first is the default active pack. `additionalPacks` still registers after them. A runtime with no pack throws at construction ("The assistant runtime needs at least one domain pack from its host"). That is a host configuration error, not a runtime path.
- The runtime no longer imports or constructs `createShortletAssistantPack` and no longer imports `proposalStillAuthorised`.
- `AssistantDomainPack.proposalStillAuthorised?(action, taskState)` (new hook) and `pendingProposalAuthorised(pack, state)` (platform, assistant-platform.ts). With no proposal the answer is true. With a proposal, only the pack's hook can keep it, and a pack without the hook is treated as NOT authorised (fail closed; the proposal is removed, never kept by default).
- The shortlet pack implements the hook with the unchanged rule (`proposalStillAuthorised` in shortlet-stage-handlers.ts). The discovery handler and `applyDiscoveryShortlist` both call `pendingProposalAuthorised`.
- Hosts pass the Shortlet pack: `apps/local-guest/src/guest-server.ts` (three runtime constructions, including the cold-restore path), `scripts/assistant-live-smoke.ts` and `scripts/pilot-agent-smoke.ts`. No `dist/*.js` changed (`client.ts` is untouched; no `client.js` regeneration).
- Tests: the 32 test files that construct the runtime use `ShortletAssistantRuntime` (`test/helpers/assistant-runtime-host.ts`), a subclass whose constructor supplies the Shortlet pack first, as the host does. The behaviour of those tests is unchanged. The raw class is used only by the new composition test.

**Tests first.** The boundary allowlist had its two entries removed (createShortletAssistantPack, proposalStillAuthorised). The boundary test then failed red on exactly those two matches. `test/assistant-host-composition.test.ts` was written first and failed (the helper it imports did not exist yet). It covers: a runtime with only a fake pack registers only that pack; a runtime without the Shortlet pack refuses a Shortlet tool with `tool_denial` and does not throw; a Shortlet confirmation returns `UNSUPPORTED_ACTION`, with no throw; a pack's hook keeps its proposal; a pack without the hook removes it (fail closed); and `pendingProposalAuthorised` defaults.

**Boundary allowlist after this decision.** `createShortletAssistantPack` and `proposalStillAuthorised` are no longer allowed. The import pattern for `proposalStillAuthorised` is now the import from a `./shortlet…` module, so the platform's generic hook name is not a false match. Remaining allowlist entries, each labelled: the restoreShortletState `"shortlet"` check; `validatedCheckOutForNights` (import and recordGuestStay); the four template surface keys; and the commerce kind union. Mutation check: a re-added `createShortletAssistantPack` import to the runtime fails the boundary test (restored byte for byte afterwards).

**ADR table (this decision).**

| ADR | Constraint | Where it bites |
|---|---|---|
| 0099 section 6 | Hosts are composition roots only; no business rules in a host | The runtime takes `packs` from the host; the Shortlet pack is constructed in guest-server, the scripts and the test host, not in the runtime |
| 0099 section 4 | Packs declare; the platform consumes declarations; no pack reaches into platform internals | The proposal rule is a declared hook; the platform calls it through the pack interface |
| 0074 | Proposal authority fails closed; a stale proposal is removed, never kept | `pendingProposalAuthorised`: no hook means not authorised; `applyDiscoveryShortlist` and the discovery handler use it |
| 0070 | One mutating run per thread; interaction ids separate from domain ids | Unchanged; the transaction and the commit sites are not touched by this decision |
| 0106 | Cold restore is the normal path; closed outcomes | guest-server's cold-restore construction now passes the same Shortlet pack; the cold suites pass unchanged |

**Follow-up issue (not in this commit).** The Shortlet public API remains on the runtime, to be moved in a follow-up issue: `restoreShortletState`, `recordGuestStay`, `recordGuestArea`, `selectShortletUnit`, `clearShortletSelection`, `applyDiscoveryShortlist`; the `"shortlet"` domain check in `restoreShortletState`; the pending-card id template in `restoreShortletState`; and the `validatedCheckOutForNights` import. Raise this as a new issue under the assistant-runtime-hardening effort before its merge; it is recorded here, not filed.

**Commands and counts (this decision).**
- `env -u LLM_API_KEY npm run check` (includes the worker bundle guard): exit 0.
- Swapped and new test files (32 files, including `test/assistant-host-composition.test.ts` 6 tests, `test/assistant-runtime-boundary.test.ts` 3 tests, and the shortlet-behaviour, reply-control, platform-gate and stage-handler files): 249 tests, 247 pass, 2 fail. The 2 failures are in `test/commerce-surfaces-chromium.test.ts` (real Chromium timeouts, "Visible Northstar Tote"). AGENTS.md lists this file as an accepted failure while commerce is not shipping. Not fixed, not edited.
- Named suites: `test/assistant-runtime-boundary.test.ts`, `test/assistant-stage-handlers.test.ts`, `test/assistant-tool-argument-validation.test.ts`, `test/assistant-recorded-journeys.test.ts`, `test/assistant-recording-clients.test.ts`, `test/assistant-cold-journey.test.ts`, `test/assistant-turn-stop-cold-restore.test.ts`, `test/assistant-pending-action-restore.test.ts`, `test/assistant-proposal-replacement.test.ts`, `test/assistant-proposal-supersession.test.ts`, `test/assistant-where-chip.test.ts`, `test/assistant-artifact-authority.test.ts`, `test/assistant-booking-journey.test.ts`: 109 tests, 109 pass, 0 fail.
- `env -u LLM_API_KEY npm run test:assistant`: 67 tests, 67 pass, 0 fail.
- Not run: full `npm test` and `npm run test:workers` (batch gate).

### Follow-up after 03a3465 (28 Oct 2026): fail closed, boundary, host coverage, stale callers

Tests were written first (red) for each behaviour change, and each red run was observed before the change.

1. **Unregistered task domain fails closed (behaviour change).** Before: `#packForThread` and `candidatePack` fell back to the active pack, so a task whose pack is not registered ran another pack's rules. After:
   - A turn on a task whose pack is not registered returns `ok: true`, `controlOutcome: "tool_denial"`, `modelHandled: false`, with the unavailable copy. The planner is not called and no pack's tool runs. This is checked at the start of `handleTurn`, before the scope stage and before any commit.
   - A confirm, cancel or other platform event on such a task returns `UNKNOWN_DOMAIN` and changes nothing.
   - A task start from such a task is still allowed, so the guest can leave it. A switch to a task of an unregistered domain is refused with `UNKNOWN_DOMAIN` and the active task does not change.
   - `#packForThread` returns no pack when none is registered; its callers refuse (`applyDiscoveryShortlist` treats the proposal as not authorised, and the pending confirmation returns `UNKNOWN_DOMAIN`).
   - The `candidatePack` fallback is removed. It throws only if the guard is bypassed, which the turn guard prevents.
   - A new thread with no active task yet still works on the first registered pack.
   - Test file `test/assistant-unregistered-domain.test.ts` (5 tests). The persisted-shortlet case uses the shape a persisted Shortlet thread has: a shortlet task on a runtime whose only pack is the fake shop pack. Before the change, 3 of the 5 were red.
   - Mutation: removing the turn guard fails the test file. Restoring the candidatePack fallback is an equivalent mutant (the guard refuses first), so no test can observe it; this is why the guard is the control that is mutation-checked.

2. **Boundary test (strengthened).** The import pattern `domain import` flags any import whose source is `./shortlet*` or `./commerce*`, single or multi-line, either quote form. The reviewer's probe (`import { SHORTLET_STAGE_HANDLERS } from './shortlet-stage-handlers.js'`) is flagged: mutation fails the test. Each allowlist entry now carries `followUp` (`issue 04 decision a` or `issue 04 decision b`), checked by a regex, and each count must equal a real occurrence (a stale entry fails the exact-equality test). The import of `./shortlet-assistant-pack.js` for `validatedCheckOutForNights` is the one import allowed, with count 1.

   **Acceptance (owner, recorded).** The remaining accepted exception is: the `validatedCheckOutForNights` import, `restoreShortletState`'s `'shortlet'` check, and the Shortlet public API methods on the runtime. The owner accepted these as a follow-up issue. The narrower requirement is met: no `createShortletAssistantPack` and no `proposalStillAuthorised` in the runtime.

   **Follow-up issue (not created now).** Move the Shortlet public API (`restoreShortletState`, `recordGuestStay`, `recordGuestArea`, `selectShortletUnit`, `clearShortletSelection`, `applyDiscoveryShortlist`) and `validatedCheckOutForNights` out of `assistant-runtime.ts`, into the Shortlet pack or the Shortlet host. Remove the `'shortlet'` check in `restoreShortletState` (find the task by its pack, not the literal), and the restored pending-card id template. Then remove the matching allowlist entries, which the exact-equality test will require. Raise it under the assistant-runtime-hardening effort before its merge.

3. **Host coverage.** `test/guest-request-host-packs.test.ts` (6 tests). Each of the three concierge modes that guest-server builds a runtime for (`assistant-offline`, `openai-compatible`, `gemini`) runs one Shortlet search through `createGuestRequestHandler` twice: on the anonymous path (the default application's runtime) and for a session-scoped guest (the per-session runtime, reached with the cookie from `GET /`). The model is the scripted one, with the attempt hook: no provider, no secrets, and the mode's `modelClient` is injected. The search must return a discovery surface, so a host that drops the pack fails.
   - Mutation, one site at a time (`packs: []` in place of the Shortlet pack): the offline anonymous branch fails 2 tests, the openai/gemini anonymous branch fails 4, the per-session runtime fails 3. guest-server.ts was restored byte for byte.
   - `guest-request-handler.test.ts` needs the repo's test environment defaults (`NODE_ENV=test`, `COMMERCE_REFERENCE_TEST_KEY=allow`, from `scripts/test-env-defaults.mjs`) when run without `run-tests.mjs`. Those are the repo's own test values, not secrets; the new host test does not need them.

4. **Stale callers.** `.scratch/guest-ui-consistency/capture-23.ts` and `capture-27.ts` pass `createShortletAssistantPack` (CRLF preserved). The capture sweeps were not run. `.scratch/pilot-acceptance/head-guest-server.ts` is a frozen historical snapshot from commit `6503849` (Migrate guest UI to Weaver 0.2.1), referenced by nothing, with its acceptance artifacts. It is left unchanged. It constructs `AssistantRuntime` with no packs, so it would throw at construction under the current runtime. It is not part of any build or test.

5. **Zero-packs construction error.** `test/assistant-host-composition.test.ts` pins the throw (`/needs at least one domain pack from its host/`). Mutation: removing the throw fails it.

6. **Item-6 note (8e934d8).** The note at line 163 already says the test uses a crafted **surface** id containing `:discovery:` (`test/assistant-stage-handlers.test.ts`, the fallback-copy test). No thread-id wording remains in this Comments section. The change is intentional: the copy comes from the handler that filed the surface, not from an id lookup.

**ADRs for this follow-up.** ADR 0074 (an unauthorised or unregistered proposal is never kept by default; the hook decides); ADR 0099 section 6 (no pack fallback: the host composes, the runtime refuses what it does not register); ADR 0070 (the refusal commits nothing); ADR 0075 (refusal messages carry no values); ADR 0106 (closed outcomes: `tool_denial` and `UNKNOWN_DOMAIN` only, no new code).

**Commands and counts (`env -u LLM_API_KEY`).**
- `npm run check` (includes the worker bundle guard): exit 0.
- New and changed files: `test/assistant-unregistered-domain.test.ts` 5/5, `test/assistant-host-composition.test.ts` 7/7, `test/assistant-runtime-boundary.test.ts` 4/4, `test/guest-request-host-packs.test.ts` 6/6, `test/assistant-platform-action-gate.test.ts` 4/4, `test/assistant-reply-control-outcome.test.ts` 2/2, `test/assistant-shortlet-stage-behaviour.test.ts` 3/3, `test/assistant-stage-handlers.test.ts` 8/8. Total 39/39.
- Batch A: `shortlet-assistant-evals`, `assistant-control-metrics`, `assistant-control-outcome-count`, `assistant-task-rail`, `assistant-tool-authorization`, `commerce-agent-tools`, `conversation-router`, `demo-extended-assistant`: 87 tests, 87 pass, 0 fail.
- Batch B: `assistant-recorded-journeys`, `assistant-recording-clients`, `assistant-cold-journey`, `assistant-turn-stop-cold-restore`, `assistant-turn-stop-reasons`, `assistant-tool-argument-validation` (13/13), `assistant-pending-action-restore`, `assistant-proposal-replacement`, `assistant-proposal-supersession`, `assistant-where-chip`, `assistant-artifact-authority`, `assistant-booking-journey`: 111 tests, 111 pass, 0 fail.
- `guest-request-handler.test.ts` (with `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow`): 9/9.
- `npm run test:assistant`: 67/67.
- Mutations (each restored byte for byte): zero-packs throw removed (1 failing test); reviewer's probe import added (1 failing test); turn guard removed (1 failing test); the three guest-server Shortlet-pack sites (2, 4 and 3 failing tests); the candidatePack fallback restored (equivalent, see item 1).
- Not run: real-Chrome files (not run per instruction), the capture sweeps, full `npm test`, `npm run test:workers` (batch gate).

### Final follow-up after 4d25be0 (28 Oct 2026)

Tests were written first where behaviour changed. All commands ran with `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow` (the repo's test defaults from `scripts/test-env-defaults.mjs`). Real-Chrome files were not run.

1. **Cancel and unknown platform event (blocking gap).** `test/assistant-unregistered-domain.test.ts` adds two tests on a persisted shortlet task served without the Shortlet pack. A cancel is refused with `UNKNOWN_DOMAIN`, the thread snapshot (`threadSnapshot`) is unchanged and the pending action is not cleared. An unknown platform event (`platform.unknown.event`) is refused as `UNKNOWN_DOMAIN` (before the event lookup, not `UNSUPPORTED_EVENT`) with the same before/after snapshot. Mutation: `handleAssistantEvent`'s guard set to `if (false)` fails 3 tests in that file (the two new ones and the existing confirmation test).

2. **Boundary bypass (blocking).** The domain-import pattern is now `\b(?:import|export)\b[^;]*?["']\.\/(?:shortlet|commerce)[^"']*["']`. It matches a regular or type import, a side-effect import, a re-export (`export … from`) and a dynamic import (`import(…)`), in either quote form, single or multi-line. The test title is corrected to say what it checks. Probes: 9 forms flagged, 2 clean forms not flagged. Mutations, each appended to the runtime and restored byte for byte, each fail the boundary test: side-effect `import './shortlet-stage-handlers.js';`, re-export `export { … } from './shortlet-stage-handlers.js';`, shortlet dynamic `void import('./shortlet-stage-handlers.js')`, and commerce dynamic `void import('./commerce-assistant-pack.js')`.

3. **Follow-up issue 07 (created).** `.scratch/assistant-runtime-hardening/issues/07-move-the-shortlet-public-api-out-of-the-runtime.md`: Status `needs-triage`, `Blocked by: 04`, with Why, What to build, an ADR table, acceptance criteria and Tests, in the format of issues 01 to 06. It covers the six methods, `validatedCheckOutForNights`, the `"shortlet"` literal and the pending-card id template. It is linked from:
   - the PRD table (row 07) and the PRD order section;
   - the allowlist `followUp` strings (`issue 07 (07-move-the-shortlet-public-api-out-of-the-runtime.md)`);
   - this Comments section.
   The boundary test fails if an allowlist entry cites the file and the file does not exist, and checks that the issue names every moved method and says `Blocked by: 04`.

4. **Dangling active task id (low, source fix).** `activeTaskId` matching no task is now refused the same way as an unregistered domain. Before the fix, `candidatePack()` threw outside any try, from `handleTurn`'s scope stage. Test: "a dangling active task id is refused as a closed outcome, not a throw": `ok: true`, `controlOutcome: "tool_denial"`, no planner call, no pack rule, no commit, and the task-list copy. Mutation (the guard's dangling branch removed, `return undefined`) fails that test.

5. **Refusal copy and doc comment (low).** New copy key `ASSISTANT_CONTROL_COPY.unregisteredTask`: "This task is not available in this conversation any more. Choose another task from the task list, or start a new one, to continue." It replaces the generic retry copy in the turn refusal and in the event refusals (`UNKNOWN_DOMAIN` messages). No copy test pins a key by name, so none changed. The `tool_denial` doc comment in `assistant-runtime.ts` now documents the refusal of an unregistered or dangling task: no planner, no pack rule, no commit, no stop reason (it refuses before the planner loop). The ADR 0106 outcome list is unchanged; no outcome was added.

6. **Host test header (low).** `test/guest-request-host-packs.test.ts`: the header now says that a site dropping its pack fails in the constructor (the zero-pack guard), not at the search assertion, and that the assertion is reached only when the pack is passed.

**Boundary test.** The allowlist's `followUp` values name issue 04 decision a, or issue 07 by file name; the existence check for the file is in the test.

**Mutation results (all restored byte for byte; `assistant-runtime.ts` checked after each).**
- Event guard `if (false)`: 3 failing tests (unregistered-domain file).
- Dangling-task branch removed: 1 failing test.
- Side-effect import, re-export, shortlet dynamic import, commerce dynamic import: 1 failing boundary test each.
- Earlier in this issue (unchanged by this follow-up): zero-packs throw removed, reviewer's probe import, turn guard removed, the three guest-server Shortlet-pack sites (2, 4, 3 failures).

**Commands and counts.**
- `npm run check` (includes the worker bundle guard): exit 0.
- New and changed files: `test/assistant-unregistered-domain.test.ts` 8/8, `test/assistant-runtime-boundary.test.ts` 5/5, `test/guest-request-host-packs.test.ts` 6/6, `test/assistant-host-composition.test.ts` 7/7, `test/assistant-stage-handlers.test.ts` 8/8, `test/assistant-platform-action-gate.test.ts` 4/4, `test/assistant-reply-control-outcome.test.ts` 2/2, `test/assistant-shortlet-stage-behaviour.test.ts` 3/3. Total 43/43.
- Batch B: `assistant-recorded-journeys`, `assistant-recording-clients`, `assistant-cold-journey`, `assistant-turn-stop-cold-restore`, `assistant-turn-stop-reasons`, `assistant-tool-argument-validation`, `assistant-pending-action-restore`, `assistant-proposal-replacement`, `assistant-proposal-supersession`, `assistant-where-chip`, `assistant-artifact-authority`, `assistant-booking-journey`: 111/111.
- Batch A: `shortlet-assistant-evals`, `assistant-control-metrics`, `assistant-control-outcome-count`, `assistant-task-rail`, `assistant-tool-authorization`, `commerce-agent-tools`, `conversation-router`, `demo-extended-assistant`, `guest-request-handler`: 96/96.
- `npm run test:assistant`: 67/67.
- Not run: real-Chrome files, full `npm test`, `npm run test:workers` (batch gate).
