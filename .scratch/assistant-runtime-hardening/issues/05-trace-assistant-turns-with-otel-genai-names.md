# Emit assistant diagnostics from the pilot hosts under OpenTelemetry GenAI names

Status: needs-triage
Type: task
Blocked by: 04
Requested: 25 Oct 2026
PRD: `../PRD.md`

## Why

`AssistantRuntime` emits a good set of diagnostic events (`AssistantDiagnosticEvent`: stage, round, tool name, success, failure class, result count) through `options.onDiagnostic`. But only the two smoke scripts pass `onDiagnostic` (`scripts/assistant-live-smoke.ts`, `scripts/pilot-agent-smoke.ts`). `guest-server.ts` builds the runtime without it (around lines 2355, 2372 and 2494), and that is the only place real traffic builds one: the Node pilot (`apps/pilot/src/pilot-server.ts`, `local-pilot-server.ts`) and the Cloudflare `shortlet-pilot-do.ts` all go through `createGuestRequestHandler`. In a deployed pilot, a looping model, a provider outage or a tool that keeps failing preconditions leaves no trace.

ADR 0079 requires end-to-end correlation and redacted metrics. The OpenTelemetry GenAI semantic conventions (`gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.tool.name`, `error.type`) are the names tracing tools now read. Using them costs nothing and keeps the option of a real OTel exporter later.

## What to build

- One mapper from `AssistantDiagnosticEvent` (plus issue 02's stop reason and the model response `usage`) to a flat record with OTel GenAI attribute names, and a turn correlation id that is not a domain id (ADR 0070).
- Add a diagnostic sink option to `createGuestRequestHandler`, pass it to every `AssistantRuntime` built there, and supply it from the Node pilot servers and `shortlet-pilot-do.ts`. Output is one structured JSON log line per event through the host's existing logger (Workers Logs on Cloudflare). No OpenTelemetry SDK dependency in this issue.
- An allow-list, not a deny-list: only the mapped fields are written. No prompt, reply, tool arguments, tool results, guest text, actor ids, tenant ids or session credentials (ADR 0075).

## Open questions for triage

1. Is per-event logging in the Worker within the Workers Logs volume the owner is willing to pay for, or should it be per-turn summaries only?
2. Does the turn correlation id need to join ADR 0079's interaction stream trace id now, or later with the transport work?

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0079 | End-to-end correlation, redacted metrics | Correlation id; one record per event or turn |
| 0075 | No restricted data, secrets or raw content in logs | Allow-listed fields only |
| 0070 | Interaction ids separate from domain ids | Correlation id is a run id, never a booking or payment id |
| 0095 | Pilot hosted on Cloudflare | Workers Logs as the sink |

## Acceptance criteria

To be finalised at triage. Draft:

1. Every host that serves real assistant traffic passes a diagnostic sink to `AssistantRuntime`.
2. Each diagnostic record uses the OTel GenAI attribute names for operation, model, token usage, tool name and error type.
3. A diagnostic record contains only allow-listed fields; a test feeds a turn with personal data in the guest text and tool arguments and asserts none of it appears.
4. All records of one turn share a correlation id that is not a domain identifier.

## Comments
