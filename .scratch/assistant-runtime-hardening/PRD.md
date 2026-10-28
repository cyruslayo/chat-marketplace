# Harden the assistant runtime without adopting an agent framework

Status: needs-triage
Requested: 25 Oct 2026

## Decision this effort rests on

On 25 Oct 2026 the owner asked whether the concierge needs an agent framework (LangGraph, Mastra, Google ADK, OpenAI Agents SDK, Vercel AI SDK, Cloudflare Agents SDK). The answer was no. The in-house runtime under `apps/local-guest/src/assistant/` already covers what those frameworks provide:

| Framework feature | What this repo has |
|---|---|
| Provider-neutral model interface | `AssistantModelClient` (`assistant-model.ts`), with Gemini and OpenAI-compatible adapters |
| Provider fallback | `FallbackModelClient`: only on 429, 5xx or timeout; any other failure fails closed |
| Tool calling with human approval | Tool `category` (`read` / `proposal` / `confirmation`), pending actions and confirmation surfaces |
| Multi-agent routing | Domain packs (shortlet, commerce) and the cross-domain router |
| Bounded loop and cost cap | `MAX_ASSISTANT_TOOL_ROUNDS` (4) and `ModelCallBudget` with the deterministic fallback (ADR 0080) |
| Generative UI | Weaver / A2UI (ADR 0081) |
| Evals | `ScriptedAssistantModel` and `test/shortlet-assistant-evals.test.ts` |

The frameworks also want to own state, memory, checkpoints and the loop. ADR 0081 (Weaver stays an interface runtime, replaceable, with no framework types in authoritative packages), ADR 0070 (a thread never owns domain state; one mutating run per thread) and ADR 0075 (model and tool content is untrusted) put that state in platform and domain code on purpose. A framework would have to be fenced off, and would add little.

If a dependency is ever added, the only candidate is the Vercel AI SDK core (`ai`), and only as one more `AssistantModelClient` adapter. It is not part of this effort.

## What this effort does instead

Borrow the parts of those frameworks that this runtime lacks, as small changes to the existing code:

| Issue | Idea borrowed |
|---|---|
| [01](issues/01-validate-tool-arguments-against-their-schema.md) | Tool arguments validated against their declared schema before any tool runs |
| [02](issues/02-typed-stop-reasons-and-bounded-final-reply.md) | Explicit per-turn stop conditions with a typed reason |
| [03](issues/03-replay-recorded-conversations-as-evals.md) | Recorded conversations replayed as regression evals |
| [04](issues/04-split-assistant-runtime-into-stage-handlers.md) | Split `assistant-runtime.ts` into one handler per stage, behind a small shared interface (what "graph" frameworks give, without the dependency) |
| [05](issues/05-trace-assistant-turns-with-otel-genai-names.md) | Diagnostics named after the OpenTelemetry GenAI conventions |
| [06](issues/06-durable-assistant-thread-state.md) | Durable per-thread state and a single mutating run per thread (the useful idea in the Cloudflare Agents SDK) |
| [07](issues/07-move-the-shortlet-public-api-out-of-the-runtime.md) | Move the Shortlet public API and `validatedCheckOutForNights` out of the runtime (follow-up to issue 04 decision b; blocked by 04) |

## Order

01, 02 and 03 are independent and small. 04 waits for all three: 03 gives the split a behaviour safety net, and 01 and 02 change the tool loop that 04 moves. 05 and 06 wait for 04.

07 follows 04: it moves the Shortlet public API and `validatedCheckOutForNights` out of the runtime, which 04 left there with the owner's acceptance (decision b). It is not part of the 01 to 06 order above.

## Out of scope

- Adding any agent framework or the `ai` package.
- Changing Shortlet Booking or Commerce business rules, prompts or tool sets.
- Streaming model output to the client (ADR 0079 transport work is separate).
