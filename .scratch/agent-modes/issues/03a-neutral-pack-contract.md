# Make the domain-pack contract domain-neutral (additive, no guest-visible change)

Status: ready-for-human
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
