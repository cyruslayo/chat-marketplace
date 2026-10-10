# OpenAI-compatible model adapter (DeepSeek and OpenAI)

Status: resolved
Type: task
Blocked by: none

## What to build

Only Gemini is implemented (`apps/local-guest/src/assistant/gemini-interactions-client.ts`). Add a second `AssistantModelClient` adapter that speaks the OpenAI Chat Completions protocol, so the same code reaches DeepSeek (`https://api.deepseek.com`) or OpenAI (`https://api.openai.com/v1`) by configuration. Use raw `fetch`; add no dependency and no vendor types (ADR 0068). Keys stay server-side (ADR 0069). Never log keys, prompts or replies (ADR 0075).

DeepSeek processes guest text outside Nigeria; counsel must clear that (issue 03) before DeepSeek serves real guests.

## Acceptance criteria

- [x] The request maps the system instruction, user and assistant turns, tool calls and tool results onto Chat Completions messages, and tool definitions onto `tools[].function`.
- [x] Tool calls in the response become `AssistantToolCall`s; a tool call with a missing id or name, or arguments that are not a JSON object, fails closed.
- [x] A connection failure is retried exactly once; an HTTP error response is never retried.
- [x] HTTP 429 surfaces as `RateLimitError` and other HTTP errors as `APIError`, carrying only a sanitised status and code, so `classifyFailure` and `createFailureDiagnostic` label them.
- [x] Requests time out after the configured timeout (default matches `DEFAULT_GEMINI_TIMEOUT_MS`).
- [x] The adapter refuses to construct without an API key, a model, or an HTTPS base URL.

## Answer

Resolved on branch `launch/llm-providers` (commit "Add DeepSeek/OpenAI concierge provider…").

- `apps/local-guest/src/assistant/openai-compatible-client.ts`: `OpenAiCompatibleClient`, raw `fetch` to `{LLM_BASE_URL}/chat/completions`.
- Tests: `test/openai-compatible-client.test.ts`, one per criterion.
- ADRs: 0068 (no vendor SDK or types), 0069 (server-side key), 0070 (provider `rawStep` ignored, none emitted), 0075 (errors carry sanitised status and code only).
- Not yet verified: a live call against DeepSeek. Run `CONCIERGE_MODE=openai-compatible npm run pilot:local:agent-smoke` with real `LLM_*` keys. The `search_stays` schema uses `["string","null"]` union types; if DeepSeek rejects them, the smoke will show a 400.
