# Give every assistant turn a typed stop reason and bound the final reply call

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 25 Oct 2026
PRD: `../PRD.md`

## Why

`AssistantRuntime.handleTurn` (`apps/local-guest/src/assistant/assistant-runtime.ts`, around lines 393–600) already caps the tool loop at `MAX_ASSISTANT_TOOL_ROUNDS` (4, in `assistant-platform.ts`). What it does not do:

- **Say why a turn stopped.** A natural reply, hitting the round cap, and a provider failure all look the same in `AssistantTurnOutput` and in the diagnostics. Frameworks expose this as a stop or finish reason; it is what tells you a prompt or tool set is making the model loop.
- **Bound the extra call after the cap.** When the cap is reached, one more `generate` runs with `tools: []` and no `timeoutMs`, so it uses the adapter default rather than the 20-second limit the loop uses. A turn can therefore run longer than intended, and the call is not distinguished from a normal round.
- **Bound the whole turn.** Each call has a timeout, but nothing bounds the turn. ADR 0079 sets a provisional 120-second standard-run limit.
- **Name its limits.** `20_000` is a literal inside the loop (AGENTS.md anti-pattern 3).

## What to build

- A `stopReason` on the turn result and on a final diagnostic event: `"reply"` (model answered without tools), `"round_limit"` (cap reached, summary call made), `"turn_deadline"` (whole-turn limit reached), `"error"` (failure path; the existing `failureClass` stays). Use only these four unless a test shows a case they do not cover.
- `AssistantRuntimeOptions` gains `modelCallTimeoutMs` and `turnDeadlineMs`. Defaults: 20 000 ms (today's value) and 120 000 ms (ADR 0079 standard-run limit, provisional). Cite ADR 0079 at the default.
- The post-cap summary call uses `modelCallTimeoutMs`, and no call starts after `turnDeadlineMs` has passed. A deadline reached before any successful application operation takes the existing rollback path (thread unchanged, `CONCIERGE_UNAVAILABLE`); after one, it takes the existing projected-operation fallback.
- No change to the round cap value, the prompts, or `ModelCallBudget` (it already counts the summary call through `BudgetedModelClient`).
- `scripts/pilot-agent-smoke.ts` works out a stop reason from the diagnostics itself (`providerStopReason`). Switch it to the new field if the mapping is one to one; otherwise leave it and note why in Comments.

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0079 | Provisional 120-second standard-run limit; timeouts never reverse committed commands | `turnDeadlineMs` default; deadline after a committed operation keeps it |
| 0080 | Deterministic fallback for critical workflows | Failure paths still hand over as today |
| 0075 | Diagnostics carry no prompt, reply or personal data | The stop-reason diagnostic is an enum and counts only |

## Acceptance criteria

1. A turn the model answers without tool calls reports stop reason `reply`.
2. A turn that reaches the round cap reports stop reason `round_limit` and makes exactly one summary call with no tools.
3. The summary call after the round cap is made with the configured model-call timeout.
4. A turn that passes the turn deadline before any application operation reports `turn_deadline`, starts no further model call and leaves the thread unchanged.
5. A turn that passes the turn deadline after an application operation keeps that operation's state and surfaces.
6. A provider failure reports stop reason `error` with its existing failure class.
7. The model-call timeout and turn deadline default to 20 000 ms and 120 000 ms and can be overridden through runtime options.

Use an injected clock or a scripted model that advances time; no real waits.

## Tests

`test/assistant-turn-stop-reasons.test.ts` (new). Affected: `npm run test:assistant`, `test/assistant-task-rail.test.ts`.

## Comments
