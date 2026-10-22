# Run the concierge on GPT-6 Luna via OpenRouter

Status: resolved
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

- [x] AC1: With `CONCIERGE_MODE=openai-compatible` and OpenRouter settings, a discovery turn ("2-bed in Lekki for 3 months from 1 Nov") calls the model and executes `search_stays`, using a stub fetch with the helpers in `test/openai-compatible-client.test.ts`.
- [x] AC2: Explicit confirmation or cancellation of a pending action never calls the model. The stub records zero requests.
- [x] AC3: A provider 429, a 5xx or a timeout falls back to the deterministic concierge, and the guest still gets a reply.
- [x] AC4: When the daily model-call budget is exhausted, the deterministic concierge answers.
- [x] AC5: With `openai-compatible` selected, a missing or empty `LLM_API_KEY`, or a non-HTTPS `LLM_BASE_URL`, is a startup error.
- [x] AC6: `CONCIERGE_MODE` defaults to `deterministic` when unset. A workers test pins this.
- [x] AC7: Token usage is returned from the client, and no prompt or reply text appears in diagnostics or logs.
- [x] AC8: `npm run check` passes and the issue's own and affected tests pass: `test/demo-openrouter.test.ts` (the named acceptance tests), `test/openai-compatible-client.test.ts`, `test/concierge-configuration.test.ts`, and the Workers specs `apps/cloudflare/test/cloudflare-config.spec.ts` and `apps/cloudflare/test/ops-routes.spec.ts` (commands and counts recorded in Comments); the full `npm test` and `npm run test:workers` run at the batch's pre-merge gate.

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

- 22 Oct 2026: `GET https://openrouter.ai/api/v1/models` lists `openai/gpt-6-luna` (`OpenAI: GPT-6 Luna`). Base prices per token are prompt `0.0000001` USD and completion `0.0000005` USD. Cache-read and cache-write prices are `0.00000001` and `0.000000125` USD per token. At 272000 prompt tokens, the listed override is prompt `0.0000002` and completion `0.00000075` USD per token. These are observed prices, not runtime constants.
- 22 Oct 2026: OpenRouter documents attribution headers as optional: <https://openrouter.ai/docs/api_reference/overview#headers>. This change will omit them.
- 22 Oct 2026: Six named Node acceptance tests were red before implementation. AC6 has a dedicated Workers test. The existing client fixtures now live in `test/helpers/openai-compatible-client.ts` and are shared.
- 22 Oct 2026: Type checking, 68 focused assistant/provider/guardrail tests, and 24 Workers files (164 tests) passed. The stalled response-body test proved an unbounded wait before the timeout fix. The new deadline covers both headers and JSON decoding.
- 22 Oct 2026: `CloudflareEnv` already inherits `LLM_*` through `PilotEnvironmentSource`. The shared core loader supplies `configuration.concierge`; the new build bindings complete that existing path.
- 22 Oct 2026: The counters and call budget retain their existing per-runtime lifecycle. Runtime restarts reset them; they are not a durable account-wide spending limit. Live model quality, latency, and cost remain issue 03 work.
- 22 Oct 2026 (AC8 gate, run by the implementing agent after the handoff): `npm run check` exited 0 (root, Cloudflare, test, tooling tsconfigs and the Worker bundle guard). `npx tsx --test test/demo-openrouter.test.ts test/openai-compatible-client.test.ts test/concierge-configuration.test.ts` reported 18 tests, 18 pass, 0 fail. `npm run test:workers -- apps/cloudflare/test/cloudflare-config.spec.ts apps/cloudflare/test/ops-routes.spec.ts` reported 2 files and 9 tests, all passing. `git diff --check` was clean. The full `npm test` and `npm run test:workers` were not run here, per the owner's per-issue scope; they remain the batch pre-merge gate.
- 22 Oct 2026: Definition of Done self-review. (1) Each AC1–AC7 has a named test that mirrors its text; AC6 is a Workers test and AC7 has an ops Workers test. (2) Failure paths: AC2 covers confirm and cancel; AC3 covers 429, 503, a request timeout and a stalled body; AC5 covers an empty key, a non-HTTPS URL and the production OpenRouter refusal. (3) ADRs listed above were read; 0075, 0080 and 0105 were re-read for this review. (4) Each new injected dependency is used (`conciergeDiagnostics`, `modelCallBudget`). (5) The `3000` daily cap in `.dev.vars.example` matches `PILOT_LIMIT_DEFAULTS`. (6) Diagnostics and logs carry counts only; AC7 asserts no prompt, reply or key text. (7) Gates above recorded.

## Implementation plan

Write named tests for AC1–AC7 before implementation. AC8 is the executable check gate: `npm run check` plus the issue's own and affected tests; it must not recursively invoke itself from a test.

| ADR | Constraint | Affected code / criterion |
| --- | --- | --- |
| 0068 | Keep the provider behind the existing raw-fetch adapter | Client and bindings; AC1, AC5 |
| 0069 | Preserve the pinned protocol and server-side model access | Adapter/configuration; AC1, AC5 |
| 0072 | Preserve the command gate and explicit confirmation | Pending actions; AC2 |
| 0080 | Preserve deterministic recovery and financial authority | Transport and budget fallback; AC2–AC4 |
| 0075 | Diagnostics contain counts and normalized fields only | Usage/counters; AC7 |
| 0079 | Model evidence remains a separate required gate | Benchmark issue 03 |
| 0095 | Preserve Cloudflare state authority and ordinary processor gates | Host configuration; AC5 |
| 0105 | OpenRouter is a staging demo processor; production cannot use this exception | Startup guard; AC5 |
| 0099 | The platform owns model clients, tool loops, and shared diagnostics | Runtime, budget, and ops; AC1–AC7 |

## Answer

The concierge runs on `openai/gpt-6-luna` through OpenRouter when `CONCIERGE_MODE=openai-compatible` is set at build time, with the `LLM_*` settings and secret. Unset, the mode stays deterministic. Pending confirmations and cancellations bypass the model even after the daily budget is spent. Provider 429, 5xx and timeouts, including a stalled response body, fall back to the deterministic concierge. Token usage is returned as a neutral field. `/_ops/status` exposes numeric model-handled and fallback turn counts. Production refuses OpenRouter under ADR 0105. Live quality, latency and cost are issue 03.
