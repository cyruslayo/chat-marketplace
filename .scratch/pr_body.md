## Summary

Builds a complete, locally runnable, task-oriented **Shortlet Guest Assistant v1** completely offline, reserving only the final live Gemini API smoke test for the human developer.

### Key Highlights
- **Provider-Neutral Architecture**: Separates model contract (`AssistantModelClient`), working state (`AssistantThreadState`), and transactional runtime orchestrator (`AssistantRuntime`) with bounded tool execution loops (max 4 rounds per turn) and state rollback on error.
- **Interactions API Adapter**: Uses `@google/genai` Interactions API (`interactions.create`) with `store: false`, `generation_config: { thinking_level: ... }` using `Interactions.ThinkingLevel`, and default model `gemini-3.8-flash` (configurable via `GEMINI_MODEL`).
- **Stateless Thought-Signature Continuity**: Preserves opaque provider-generated steps (thought steps with signatures, model_output, function_call) across user turns without reconstruction.
- **Offline Scripted Model**: Offline deterministic provider (`ScriptedAssistantModel`) capable of multi-turn search refinement, unit detail resolution, comparisons, and proposal cards without network or quota usage.
- **Two-Phase Consequential Actions**: Human-in-the-loop protection for Request to Book, Accept Offer, and Start Payment. Actions require explicit human confirmation (via Weaver UI button or conversational affirmation) before executing against domain applications. Ambiguous inputs fail closed.
- **Pre-execution Revalidation & Post-Commit Reconciliation**: Revalidates truth immediately before consequential actions; commits state authoritatively upon command success so downstream presentation or simulation failures cannot roll back truth or replay actions.
- **Date Provenance Enforcement**: Calendar anchor September 2026 (2026-09-03T10:00:00Z). Forbids fabricated check-in dates; requires explicit dates or deterministic demo window.
- **30-Scenario Offline Eval Suite**: Full test coverage in `test/shortlet-assistant-evals.test.ts` (100% pass rate).
- **Safety**: Live Gemini API smoke test intentionally NOT run during automated building or testing. Quota spent: 0.

