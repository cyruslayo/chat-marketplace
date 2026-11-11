# Make the domain-pack contract domain-neutral (additive, no guest-visible change)

Status: resolved
Type: task (refactor, behaviour-preserving)
Blocked by: owner release. ADR 0107 "Settled" (8 Nov 2026): slices 3 to 5 wait for the owner's choice of the first real second domain (map slice 6). Issues 02 and 01b are resolved and do not block this issue.
Requested: 10 Nov 2026

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 5.2 (`presentation`) and section 5.7 ("Generic pack contract"); [ADR 0107](../../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md) decisions 1 and 3; [map](../map.md) slice 3. ADR 0099 decision 7 asks that the interface be shaped against two packs; this issue prepares the seam, the second pack is slice 6.

## Why

The pack contract is stays-shaped in four places, which blocks a second pack and a mode presentation:

- `AssistantDomainPack` (`apps/local-guest/src/assistant/assistant-platform.ts:112`) requires five booking methods: `bookingRequestSurface` (`:174`), `conditionalOfferSurface` (`:175`) and three more. The commerce pack returns `[]` from all five (`commerce-assistant-pack.ts:237`).
- `AssistantTaskState` (`assistant-state.ts:79`) has `goal: "find_stay" | "book_stay" | "manage_booking" | null` and `stayIntent`. Every pack shares it.
- `ScopeContext` (`scope-classifier.ts`, the `hasShortlist`, `hasSelectedStay` and `hasOffer` fields) hard-codes stays facts.
- The pack has no presentation field. `ModePresentation` and its validator already exist (`apps/web-agent/src/guest-content.ts:645` and `:772`, validator `validateModePresentation`), and the stays value is `GUEST_MODES.stays` (`guest-content.ts:725`), but no pack declares it. `shortlet-app.ts:787` holds it as a constant `#defaultMode`.

This issue adds the neutral hooks beside the old ones, so nothing breaks and the commerce pack compiles unedited (ADR 0104).

## What to build

1. **Presentation field.** Add optional `presentation?: ModePresentation` to `AssistantDomainPack`. Reuse `validateModePresentation`; do not write a second validator. `AssistantPackRegistry` refuses a pack whose presentation fails validation, naming the pack id and never echoing values (fail closed, ADR 0107 decision 3). The stays pack declares `GUEST_MODES.stays`.
2. **Surfaces map.** Add optional `surfaces?: Readonly<Record<string, (artifact: unknown, surfaceId: string) => readonly unknown[]>>`, keyed by pack-declared stage kind. The five booking methods become optional in the type. Rule: a pack that declares `surfaces` gets only those renderers, and an undeclared kind returns `[]` and renders nothing (fail closed, ADR 0074). A pack that declares no `surfaces` keeps using the legacy methods. The stays pack declares both forms with the same functions, so its output is identical.
3. **Pack-owned task state.** Add optional `initialState(): unknown`, `parseState(value: unknown): unknown | undefined` and `stateSummary(state: unknown): { label: string; status: string }`. `parseState` returns `undefined` for any unknown shape and never coerces. `AssistantTaskState` stays as the stays pack's own type behind the hook, so no `any` enters the domain layer (AGENTS.md anti-pattern 5). Runtime callers that need a stays field keep using the typed stays state until slice 3b.
4. **Scope facts.** Add optional `scopeFacts?(state: AssistantTaskState): Readonly<Record<string, boolean>>`. When absent, `ScopeContext` gets the three existing booleans, so the classifier input is unchanged for stays.
5. **At-risk hook.** Add optional `atRisk?(state: AssistantTaskState): boolean`, modelled on `proposalStillAuthorised` (`assistant-platform.ts:200`, consumed by `pendingProposalAuthorised` at `:213`). Absent means "at risk" (fail closed). Issue 03f consumes it; this issue only defines it and a helper `packAtRisk(pack, state)`.
6. **Stays pack moves onto the contract.** `createShortletAssistantPack` (`shortlet-assistant-pack.ts:1518`) declares `presentation`, `surfaces`, `initialState`, `parseState`, `stateSummary`, `scopeFacts` and `atRisk`. Its behaviour is identical.
7. **Commerce pack unchanged.** `commerce-assistant-pack.ts` is not edited. Record its composed instruction (`composeSystemInstruction`) before the first code change in Comments, and assert it is unchanged after.
8. **Fake pack.** `createFakeShopPack` (`test/helpers/fake-domain-pack.ts:4`) implements the neutral hooks and no booking method, to prove the contract without stubbing booking.

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 1 | A mode is the pack's static `presentation`. | Step 1. |
| 0107 decision 3 | Presentation is closed, bounded, validated at registration, and the model never writes it. | Step 1 uses `validateModePresentation`. |
| 0107 Consequences | A second pack declares a presentation and does not need shell edits. | Steps 1 and 2. |
| 0099 decision 4 | Packs declare; they do not reach in. The platform consumes the declarations. | Hooks are declarations. No new platform import into the pack. |
| 0099 decision 7 | The interface is shaped against two packs. | The hooks are neutral, but no second real pack exists yet. Say so in Comments. |
| 0074 | Fail-closed surfaces. An unknown stage renders nothing. | Step 2. |
| 0104 decisions 1 and 5 | Commerce stays off. The commerce pack is not changed. | Step 7. |
| 0106 "Tools and context" | Tool and state checks are unchanged. | Parse fails closed; no check is weakened. |
| 0106 "Scope" | The classifier verdict stays advisory. Scope facts add input, not authority. | Step 4. |
| 0077 | One copy source. Presentation copy lives in `guest-content.ts`. | Step 1 refers to it, does not copy it. |
| 0075 | Minimal projection. Pack state never adds persisted fields in this issue. | No persistence change (see 03b). |

## Acceptance criteria

Each is its own `test()` in a new file `test/assistant-pack-contract.test.ts`, named after the criterion.

1. A pack declaring a valid presentation registers; a pack whose presentation has an unknown key or an over-length string is refused at registration, and the error names the pack id and no value.
2. A pack that declares `surfaces` renders a declared stage kind; an undeclared kind returns no A2UI and does not fall through to a legacy method.
3. `parseState` returns `undefined` for an unknown shape and for a `null` or array input; a restore that cannot parse its state creates no task.
4. Without `scopeFacts`, the classifier context carries the three existing booleans unchanged; with `scopeFacts` on the fake pack, its facts reach `ScopeContext`.
5. Without `atRisk`, `packAtRisk` returns `true`; with `atRisk`, the hook's answer is returned.
6. The commerce pack's composed instruction equals the value recorded before this issue.
7. The stays pack's `composeSystemInstruction` equals `ASSISTANT_SYSTEM_INSTRUCTION`, and its `surfaces` output equals the legacy methods' output for the same artifact.

## Verification

Per CLAUDE.md "Test scope", run only these:

- `env -u LLM_API_KEY npm run check`.
- `env -u LLM_API_KEY npx tsx --test test/assistant-pack-contract.test.ts test/assistant-pack-registry.test.ts test/assistant-neutral-preamble.test.ts`.
- `env -u LLM_API_KEY npx tsx --test test/assistant-cold-journey.test.ts` with the assistant runtime enabled, a cold restore (new `LocalGuestApp` over the same store) before every event, the staging-like clock (2026-10-27) and a staging-like guest with no seeded phone or email. This is the model journey.
- `env -u LLM_API_KEY npx tsx --test test/commerce-agent-tools.test.ts test/shortlet-assistant-evals.test.ts` (both import the pack).
- Record the commands and counts under `## Comments`.
- Full `npm test` and `npm run test:workers` run once per batch (Test scope), not here.

## Out of scope

- Persisting `activeTaskId` or task lists (03b).
- Per-task lanes and history (03d).
- Reading `presentation` in the mode shell or the client (03c).
- The tier logic that calls `atRisk` (03f).
- Any commerce change, and any change to the stays prompt text.

## Comments

### Agent, implementation (Agent modes issue 03a)

Status at this entry: `ready-for-agent`. It is not set to `resolved`, for the two gaps listed under Definition of Done, items 1 and 2.

**Commerce baseline (recorded before the first code change).** `composeSystemInstruction(createCommerceAssistantPack(...))` on the unedited tree: length 766, sha256 `fdfcac01229706caf06956f298d92fbd71dd93b72ac35abbc9456beeb348d8d2`. AC6 asserts both values. `commerce-assistant-pack.ts` is not edited.

**ADR table (step 1, read before code).**

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decisions 1, 3 | A mode is the pack's static `presentation`, validated at registration; the model never writes it. | `AssistantPackRegistry.register` calls `validateModePresentation` and throws `Assistant domain pack <id> declares an invalid presentation` (no value echoed). Stays declares `GUEST_MODES.stays`. |
| 0099 decision 4 | Packs declare; the platform consumes. | All new hooks are optional declarations; no new platform import into a pack. |
| 0099 decision 7 | The interface is shaped against two packs. | Only the stays pack and the fake shop pack exist; the second real pack is slice 6. Not claimed as proven against two real packs. |
| 0074 | Fail-closed surfaces: an undeclared kind renders nothing and never falls through. | `renderPackSurface`: a pack with `surfaces` reads only that map (`hasOwnProperty`); a missing legacy method returns `[]`. `packAtRisk` is `true` unless the hook returns `false`. |
| 0104 decisions 1, 5 | Commerce stays off; commerce pack unchanged. | `commerce-assistant-pack.ts` untouched; AC6 hash. |
| 0106 scope | The classifier verdict stays advisory; facts add input, not authority. | `scopeContextFor` adds `facts`; the classifier merges them into the same minimal JSON. Stays facts repeat the three existing booleans, so the stays JSON is unchanged. |
| 0075 | Minimal projection; no persistence change. | `parseState` never coerces; nothing persisted. |
| 0077 | One copy source. | Stays presentation refers to `GUEST_MODES.stays` in `guest-content.ts`; nothing copied. |

Read in full: 0107, 0099, 0104, 0106, 0074. 0075 and 0077 were checked against the spec's table, not re-read in full.

**Files changed.**

- `apps/local-guest/src/assistant/assistant-platform.ts`: five booking renderers optional (`pendingActionSurface`, `bookingRequestSurface`, `conditionalOfferSurface`, `cardPaymentSurface`, `bookingContractSurface`); new optional `presentation`, `surfaces`, `initialState`, `parseState`, `stateSummary`, `scopeFacts`, `atRisk`; `PACK_SURFACE_KINDS`, `renderPackSurface`, `scopeContextFor`, `packAtRisk`; registry validation.
- `apps/local-guest/src/assistant/scope-classifier.ts`: `ScopeContext.facts` (optional), merged into the classifier's minimal JSON.
- `apps/local-guest/src/assistant/assistant-runtime.ts`: scope context built by `scopeContextFor`; the two pending-action renders go through `renderPackSurface`.
- `apps/local-guest/src/assistant/shortlet-stage-handlers.ts`: the seven booking renders go through `renderPackSurface`.
- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`: `STAYS_BOOKING_SURFACES` (one set of functions, used by both `surfaces` and the legacy methods); `parseShortletTaskState`; `presentation`, `surfaces`, `initialState`, `parseState`, `stateSummary`, `scopeFacts`, `atRisk`. `SHORTLET_PROMPT_SECTION` is not changed.
- `test/helpers/fake-domain-pack.ts`: extended `createFakeShopPack` with a valid presentation, `surfaces: {}`, `initialState`, `parseState`, `stateSummary`, `scopeFacts`, `atRisk`; the four booking methods removed.
- `test/assistant-pack-contract.test.ts` (new): seven tests, one per criterion.

Deviations from the spec:
- `stateSummary` returns `AssistantTaskSummary | undefined` (undefined for an unparseable state), not a bare `{label, status}`, to match `parseState`'s fail-closed rule.
- `atRisk` in `packAtRisk` uses `!== false`, so a hook that returns a non-boolean counts as at risk.
- "Five booking methods" is read as the five renderers in `assistant-platform.ts` lines 173 to 177 (pending action plus the four booking/payment/contract renderers). `unitDetailSurface` stays required.

**Verification (exact commands, counts; all with `env -u LLM_API_KEY`, run in `C:\AI2026\chat-marketplace-03a`).**

1. `npx tsx --test test/assistant-pack-contract.test.ts` before implementation: failed to load (`packAtRisk` not exported). Red as intended.
2. `npm run check`: exit 0 (root `tsc --noEmit` covers `test/**/*`, plus apps/cloudflare, tsconfig.test.json, tsconfig.tooling.json and the Worker bundle guard).
3. `npx tsx --test test/assistant-pack-contract.test.ts`: tests 7, pass 7, fail 0.
4. `npx tsx --test test/assistant-pack-registry.test.ts test/assistant-neutral-preamble.test.ts`: tests 7, pass 7, fail 0.
5. `npx tsx --test test/assistant-cold-journey.test.ts`: tests 4, pass 4, fail 0 (assistant runtime enabled, cold restore before every event).
6. `npx tsx --test test/commerce-agent-tools.test.ts test/shortlet-assistant-evals.test.ts`: tests 66, pass 66, fail 0.
7. Not run, per Test scope: full `npm test` and `npm run test:workers` (batch pre-merge gate).

**Definition of Done (`docs/agents/issue-tracker.md`).**

1. Every criterion has a named test: partly met. Seven tests, one per criterion. AC3's second clause ("a restore that cannot parse its state creates no task") is not tested: no restore path consumes `parseState` yet (03b). AC7 compares output for `pending_action` only. The four booking kinds share the same function references by construction, but no test compares their rendered output, because that needs a full artifact fixture from `test/render-*.test.ts`, and copying it is anti-pattern 4.
2. Failure paths asserted: met for AC1 (unknown key, over-length string), AC2 (undeclared kind, no legacy fall-through, no-booking pack), AC3 (`null`, array, unknown goal, bad `stayIntent`, bad fake shape), AC5 (absent hook fails closed).
3. ADRs listed and cited: met (table above).
4. No unused injected dependency: met, no constructor parameter added.
5. No invented policy string: met. The only new text is the registration error message.
6. No credential or identity material in logs: not applicable.
7. `npm run check` clean: met. Full `npm test` is the per-batch gate (Test scope), not run here.

Status stays `ready-for-agent` until items 1 (AC3 restore clause, AC7 booking-kind outputs) are closed. The owner decides whether to accept these as deferred to 03b or to add an artifact fixture.

**Scope notes.** No persistence change, no CSS or client change, no stays prompt change (`ASSISTANT_SYSTEM_INSTRUCTION` is equal to `composeSystemInstruction(stays)`). No formatter was run. The fake pack now satisfies the registry's presentation check.

### Orchestrator, owner decision (11 Nov 2026)
The owner deferred both open test gaps to 03b: (1) AC3 "a restore that cannot parse its state creates no task" is tested in 03b, where the first restore path consumes `parseState`; (2) AC7 surfaces-vs-legacy output for the four other booking kinds is tested in 03b with a shared render fixture helper (no copied fixtures, AGENTS.md anti-pattern 4). 03a is resolved on that basis. Orchestrator re-verified on the committed tree: `npm run check` exit 0; `assistant-pack-contract` + `assistant-pack-registry` 10/10 pass; `commerce-assistant-pack.ts` unedited.
