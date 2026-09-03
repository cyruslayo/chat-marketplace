# Handoff — Shortlet Guest Assistant v1 Offline (PR #48)

**Date:** 2026-09-03
**Branch:** `feat/local-guest-gemini`
**Base:** `a155bb79bc62ee1d0889c0d146e30aa455e4d552`
**Test status at handoff:** 565 / 565 passing, 0 failing across all suites (`npm test` clean, `npm run check` clean).

> **Hard constraint — no live API calls.**
> `GEMINI_API_KEY` must never be used during offline work. The only remaining live test is the real Gemini smoke (`scripts/assistant-live-smoke.ts`), which requires senior approval before running.

---

## What this PR is

A complete, production-grade offline implementation of the Shortlet Guest Assistant v1 for the `local-guest` app conforming strictly to ADRs 0004, 0015, 0070, 0072, 0074, 0075, 0080, and 0081.

---

## Status of the 12 Requirements

All 12 requirements from the `/goal` have been fully implemented, verified, and accompanied by automated tests:

| # | Requirement | Implementation Summary | Status |
|---|---|---|---|
| 1 | **Correct the Gemini Interactions API wire contract** | Uses `@google/genai` v2.21 `Interactions` types (`UserInputStep` with `TextContent`, `ModelOutputStep` with `TextContent`, `FunctionCallStep`, `FunctionResultStep`). Uses `interaction.output_text` as the primary text source. Removed `any` casts from transport boundary. | ✅ Done |
| 2 | **Preserve real provider steps in stateless mode** | Preserves verbatim provider `rawStep` (array of `Interactions.Step`) in `AssistantConversationStep` across stateless turns (`store: false`) rather than lossily re-synthesizing them. | ✅ Done |
| 3 | **Require real function-call IDs** | Fail-closed guard: missing `id`, missing `name`, or non-object `arguments` on provider `function_call` steps immediately throws. Never fabricates surrogate random UUIDs. | ✅ Done |
| 4 | **Replace self-fulfilling protocol tests** | Rewrote `test/assistant-interactions-protocol.test.ts` to test actual Interactions wire shapes (`TextContent`, `Tool`, `store: false`, default model `gemini-3.8-flash`, raw provider step round-trip, invalid call rejection). | ✅ Done |
| 5 | **Make search execute exactly once** | Eliminated redundant query: `search_stays` executes authoritative discovery query once. `AssistantToolExecutionResult` carries the resulting canonical `discoveryArtifact`, and `AssistantRuntime` converts it directly to Weaver A2UI via `discoveryArtifactToA2UI`. | ✅ Done |
| 6 | **Put all discovery filtering inside authoritative discovery** | Added `requiredAmenities?: readonly string[]` directly to `UnitDiscoveryFilters` and `UnitDiscoveryQuery.search()`. Artifact itself reflects filtered results. Added unit tests in `test/browse-one-eligible-unit.test.ts`. | ✅ Done |
| 7 | **Make Weaver search UI exactly match assistant shortlist** | Added full parity regression test in `test/shortlet-assistant-evals.test.ts` verifying that `discoveryArtifact.facts.results`, `taskState.shortlist`, and the Weaver surface render the exact same Unit IDs. | ✅ Done |
| 8 | **Remove invented Unit Detail facts** | In `assistant-runtime.ts` `get_unit_details`, retrieves unit entity from `unitRepository.findById(stay.unitId)` and generates projection via `toDiscoveryProjection(unit, dateRange)`. Zero hardcoded inspection timestamps or pricing versions. | ✅ Done |
| 9 | **Revalidate pending actions before confirmation** | `#executePendingAction` revalidates thread ID, guest actor ID, tenant ID, and evaluates `expiresAt` against the environment clock, failing closed with `STALE_SURFACE` if expired or mismatched. | ✅ Done |
| 10 | **Protect the price/offer the guest actually confirmed** | Re-reads authoritative state on confirmation. `accept_offer` validates `offerStatus === "disclosed"`, `offerVersion`, and pricing totals against pending action references; invalidates proposal with `STALE_SURFACE` on material divergence. | ✅ Done |
| 11 | **Make checkout confirmation explicit** | `start_checkout` derives live payment totals and refundable security deposit directly from `cardPaymentApp.getArtifact()` and binds them to the pending action proposal and confirmation surface. | ✅ Done |
| 12 | **Bind generated confirmation events to active surface** | `handleAssistantEvent` strictly verifies `context.surfaceId === candidateActiveSurfaces.get(PENDING_ACTION_STAGE)`, rejecting stale/superseded surfaces fail-closed as `STALE_SURFACE`. Aligned `gemini-concierge.test.ts` date baseline. | ✅ Done |

---

## Verification Results

- `npm run check` (`tsc --noEmit`): **Clean (0 errors)**
- `npm test`: **565 tests passing across all 6 test suites (0 failing, 0 skipped)**
- Zero live network requests or API keys used during testing.
