# Run the concierge on GPT-6 Luna via OpenRouter

Status: ready-for-agent
Type: AFK
Blocked by: 01
Requested: 21 Oct 2026

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

The demo sells the agent, but Cloudflare never calls an LLM.

- `apps/cloudflare/cloudflare.config.ts:86` hardcodes `CONCIERGE_MODE: bindings.text("deterministic")`.
- No `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` or `LLM_PROVIDER_LABEL` binding is declared. Only `GEMINI_API_KEY` is a secret.
- `apps/cloudflare/src/shortlet-pilot-do.ts:286` already builds the client with `createConciergeModelClient(configuration.concierge)` and passes `conciergeMode` explicitly, so only configuration is missing.
- `OpenAiCompatibleClient` (`apps/local-guest/src/assistant/openai-compatible-client.ts`) POSTs to `${LLM_BASE_URL}/chat/completions` using raw fetch over HTTPS only. OpenRouter (`https://openrouter.ai/api/v1`) has this shape, but that has never been tested.
- `loadConciergeConfiguration()` / `createConciergeModelClient()` in `apps/local-guest/src/assistant/concierge-configuration.ts` validate the mode and the `LLM_*` settings.
- In `AssistantRuntime.handleTurn` (`apps/local-guest/src/assistant/assistant-runtime.ts:285-626`):
  - the model chooses tools from `toolsForState` (at most `MAX_ASSISTANT_TOOL_ROUNDS = 4`, `assistant-platform.ts:14`);
  - confirm and cancel phrases bypass the model (`pending-actions.ts:87-95`);
  - exhausting the budget falls back to the deterministic concierge (`shortlet-app.ts:740-775`).

## What to build

1. **Confirm the model id.** `GET https://openrouter.ai/api/v1/models`, filtered for "luna". Record the exact slug and its pricing in `## Comments`. **If no GPT-6 Luna model is listed, stop and ask the owner.** Do not substitute another model.
2. **Make the mode configurable** in `cloudflare.config.ts`. `CONCIERGE_MODE` reads from the build environment and defaults to `deterministic`, so the production behaviour is unchanged unless someone sets it.
3. **Declare the bindings.** Add `LLM_BASE_URL`, `LLM_MODEL` and `LLM_PROVIDER_LABEL` as optional text bindings and `LLM_API_KEY` as a secret. Thread them through `apps/cloudflare/src/cloudflare-config.ts` into `configuration.concierge`.
4. **OpenRouter headers.** Send `HTTP-Referer` (the public origin) and `X-Title` only if OpenRouter needs them. Make them optional configuration on the client, never hardcoded strings.
5. **Return token usage.** Return `usage` (prompt and completion tokens) from `OpenAiCompatibleClient.generate` as a neutral field on the platform response type. Issue 03 consumes it. Do not log content (ADR 0075).
6. **Count model turns.** Add a redacted diagnostic counter: turns handled by the model versus turns that fell back to deterministic. Expose it in the existing `/_ops` summary.
7. **Document the settings.** Add an OpenRouter example to `.env.example` and `apps/cloudflare/.dev.vars.example`, and a line to the "Concierge model" section of `docs/pilot-deployment.md`.

## Acceptance criteria

- [ ] AC1: With `CONCIERGE_MODE=openai-compatible` and OpenRouter settings, a discovery turn ("2-bed in Lekki for 3 months from 1 Nov") calls the model and executes `search_stays`, using a stub fetch with the helpers in `test/openai-compatible-client.test.ts`.
- [ ] AC2: Explicit confirmation or cancellation of a pending action never calls the model. The stub records zero requests.
- [ ] AC3: A provider 429, a 5xx or a timeout falls back to the deterministic concierge, and the guest still gets a reply.
- [ ] AC4: When the daily model-call budget is exhausted, the deterministic concierge answers.
- [ ] AC5: With `openai-compatible` selected, a missing or empty `LLM_API_KEY`, or a non-HTTPS `LLM_BASE_URL`, is a startup error.
- [ ] AC6: `CONCIERGE_MODE` defaults to `deterministic` when unset. A workers test pins this.
- [ ] AC7: Token usage is returned from the client, and no prompt or reply text appears in diagnostics or logs.
- [ ] AC8: `npm run check`, `npm run test:workers` and `npm test` pass.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0068 / 0069 | No vendor SDK in the port; keys stay server-side | Raw-fetch client (AC1, AC5) |
| 0072 / 0080 | Command gate and deterministic parity; consequential actions are never agent-only | AC2, AC3, AC4 |
| 0075 | No prompts, replies or keys in logs | AC7 |
| 0079 | Model change needs evidence | Issue 03 |
| 0095 / 0105 | OpenRouter is a demo-only processor | Allowed only under 0105 (issue 01) |
| 0099 | The platform owns the model client and tool loop | Changes stay in platform and assistant code, not in packs |

## Comments
