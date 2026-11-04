# Decide the future of the older Gemini concierge path

Status: resolved
Type: grilling
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

`LocalGuestApp.#handleTurn` still has a third path, `handleGeminiTurn` (`apps/local-guest/src/gemini-concierge.ts`, `shortlet-app.ts:954`), used when a `geminiClient` is composed (`guest-server.ts:2444`). It runs only without the assistant runtime, has its own date handling, and has one test file (`test/gemini-concierge.test.ts`). Staging builds with `GEMINI_API_KEY` unset. Each parity change in this effort would otherwise need a third implementation.

## Decision for the owner

Retire it (remove the path, its client and test once nothing composes it), or keep it as a documented fallback and include it in the issue 16 parity suite. Recommended: retire.

## Acceptance criteria

- [x] AC1: The decision is recorded in this issue's Comments, with which hosts compose `geminiClient` today.
- [x] AC2: If retired, a follow-up issue lists the files and tests to remove. (Removed in the same change instead; no follow-up needed.)

## Answer

Retired (owner decision, 1 Nov 2026). Nothing composed the path: `geminiClient` in `createGuestHandler` (`guest-server.ts`) was declared and never assigned, so only `test/gemini-concierge.test.ts` reached it by constructing `LocalGuestApp` directly. The Gemini *assistant* model client (`assistant/gemini-interactions-client.ts`, `CONCIERGE_MODE=gemini`) is a different thing and is unchanged.

Removed: `apps/local-guest/src/gemini-concierge.ts`, `test/gemini-concierge.test.ts`, the `geminiClient` option and `#geminiClient` field and the `handleGeminiTurn` branch in `LocalGuestApp.#handleTurn`, the `geminiHistory` and `geminiLastSearch` thread fields, and the unused imports in `guest-server.ts`. The deterministic concierge is now the only non-assistant free-text path.

## Comments

- 1 Nov 2026. `env -u LLM_API_KEY npm run check`: clean (all four tsc projects and the Worker bundle guard).
- 1 Nov 2026. `env -u LLM_API_KEY npx tsx --test test/guest-real-dates.test.ts test/guest-draft-revision.test.ts test/guest-must-fix-ux.test.ts test/conversational-discovery.test.ts test/conversational-shell.test.ts test/guest-budget.test.ts test/model-quota-host-recovery.test.ts test/assistant-cold-journey.test.ts test/shortlet-assistant-evals.test.ts test/assistant-host-composition.test.ts`: 129 tests, 129 pass, 0 fail.
- ADRs: 0080 (the deterministic route stays the conventional fallback), 0099 (no domain logic moved into the runtime).
