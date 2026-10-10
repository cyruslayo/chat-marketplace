# Validated concierge configuration and provider fallback

Status: resolved
Type: task
Blocked by: 17

## What to build

Production reads `CONCIERGE_MODE` implicitly inside `startLocalGuestServer` (`apps/local-guest/src/guest-server.ts:3200`); a typo silently falls back to the deterministic concierge, and `.env.example` ships `deterministic`. Validate concierge configuration at pilot startup, pass the chosen model client explicitly from `apps/pilot/src/pilot-server.ts`, and support an optional fallback provider. The startup banner names the concierge, model and fallback, never keys (ADR 0075). Switching providers mid-thread must not replay one provider's opaque `rawStep` into another (ADR 0070).

## Acceptance criteria

- [x] `CONCIERGE_MODE` must be `deterministic`, `gemini` or `openai-compatible`; any other value fails startup.
- [x] `gemini` requires `GEMINI_API_KEY`; `openai-compatible` requires `LLM_API_KEY`, an HTTPS `LLM_BASE_URL` and `LLM_MODEL`.
- [x] `CONCIERGE_FALLBACK=openai-compatible` is accepted only with a `gemini` primary and requires the `LLM_*` settings.
- [x] The fallback client uses the secondary provider only when the primary fails with a connection error, a rate limit or a server error.
- [x] A provider never receives another provider's `rawStep`; history is rebuilt from the neutral fields.
- [x] The production pilot passes the concierge mode and model client to the guest server explicitly.
- [x] The startup banner shows the concierge mode, model and fallback, and no key.
- [x] `.env.example` and `docs/pilot-deployment.md` document the settings.

## Answer

Resolved on branch `launch/llm-providers`, same commit as issue 17.

- `apps/local-guest/src/assistant/concierge-configuration.ts`: `loadConciergeConfiguration`, `createConciergeModelClient`, `conciergeStartupFields`.
- `apps/local-guest/src/assistant/fallback-model-client.ts`: `FallbackModelClient`.
- `apps/pilot/src/pilot-config.ts` carries `concierge`; `pilot-server.ts` passes `conciergeMode` and `modelClient` explicitly; the banner prints them.
- `scripts/pilot-agent-smoke.ts` smokes the `LLM_*` provider when `CONCIERGE_MODE=openai-compatible`.
- Tests: `test/concierge-configuration.test.ts`, plus the explicit-wiring test in `test/pilot-production-composition.test.ts`. The documentation criterion is covered by `.env.example` and `docs/pilot-deployment.md`, not a test.
- Unset `CONCIERGE_MODE` still means `deterministic`, the existing default. Production must set `CONCIERGE_MODE=gemini` to run the AI concierge.
- Dead legacy `handleGeminiTurn` wiring was left in place (out of scope; plan item L6).
