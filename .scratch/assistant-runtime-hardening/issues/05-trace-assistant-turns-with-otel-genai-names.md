# Emit assistant diagnostics from the pilot hosts under OpenTelemetry GenAI names

Status: ready-for-agent
Type: task
Blocked by: 04
Requested: 25 Oct 2026
PRD: `../PRD.md`

## Why

`AssistantRuntime` emits a good set of diagnostic events (`AssistantDiagnosticEvent`: stage, round, tool name, success, failure class, result count) through `options.onDiagnostic`. But only the two smoke scripts pass `onDiagnostic` (`scripts/assistant-live-smoke.ts`, `scripts/pilot-agent-smoke.ts`). `guest-server.ts` builds the runtime without it (around lines 2355, 2372 and 2494), and that is the only place real traffic builds one: the Node pilot (`apps/pilot/src/pilot-server.ts`, `local-pilot-server.ts`) and the Cloudflare `shortlet-pilot-do.ts` all go through `createGuestRequestHandler`. In a deployed pilot, a looping model, a provider outage or a tool that keeps failing preconditions leaves no trace.

ADR 0079 requires end-to-end correlation and redacted metrics. The OpenTelemetry GenAI semantic conventions (`gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.tool.name`, `error.type`) are the names tracing tools now read. Using them costs nothing and keeps the option of a real OTel exporter later.

## Triage decisions (owner, 28 Oct 2026)

1. **Granularity: one record per turn, not per event.** Each `handleTurn` call writes exactly one JSON line (a turn summary), including turns that exit before the planner loop and turns that throw. Per-event diagnostics stay on `onDiagnostic` and are not logged.
2. **Correlation id: a fresh run id per turn** (`crypto.randomUUID()`, ADR 0070). It is never a thread, domain, booking, payment, guest, session or tenant id. It does **not** yet join ADR 0079's interaction-stream trace id; that join waits for the transport work and is recorded there.
3. **Shape choices (documented, not OTel-exact where OTel is a per-span scalar):**
   - `gen_ai.tool.name` is an array of the distinct tool names the planner proposed this turn, in first-proposed order, restricted to names registered on the runtime's packs. A proposed name that is not registered is counted in `assistant.unknown_tool_calls` and never written.
   - `gen_ai.request.model` is the configured primary model id, supplied by the host (`assistantModelName`). A fallback-served call is not distinguished (documented gap).
   - `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` are sums over the planner and post-cap summary calls whose provider reported usage. They are absent when no call reported usage. The Gemini adapter reports none today and is not changed. The scope classifier's own model calls are not counted (documented gap; plumbing it per turn is out of scope).
   - `error.type` is the closed `code` of a refused turn, or `runtime_exception` when a turn throws. It never carries an error message.
4. **Node pilot logger:** the Node pilot has no logger. It writes the record with `console.log(JSON.stringify(record))`, the same line shape the Worker writes to Workers Logs.

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0079 | End-to-end correlation, redacted metrics | Run id per turn; one redacted record per turn |
| 0075 | No restricted data, secrets or raw content in logs; untrusted model and tool content | Closed allow-list of fields; field names and closed codes only |
| 0070 | Interaction ids separate from domain ids; one run per turn | Run id is a fresh UUID, never a domain id |
| 0095 | Pilot hosted on Cloudflare; Workers Logs retention provisional | Workers Logs (console JSON) as the sink on Cloudflare |
| 0106 | Closed codes and counts only in diagnostics and telemetry | Outcome, stop reason, failure class and counts are closed values |

## What to build

- A mapper module `apps/local-guest/src/assistant/assistant-turn-record.ts`: a pure builder from the turn's facts (run id, model name, usage, planner calls, proposed tool names, the diagnostic events, the output's control outcome and stop reason, the refusal code or thrown flag, duration) to one flat record with OTel GenAI names. Only named fields are written (allow-list by construction).
- `AssistantRuntimeOptions.onTurnRecord` and `modelName`. `handleTurn` runs its body inside a per-turn run object that collects events, usage and tool names, and emits the record once in a `finally`. Mapper or sink failure is swallowed and counted on `AssistantRuntime.turnRecordDropCount`. It never changes the turn's response.
- `createGuestRequestHandler` gets `onAssistantTurn` and `assistantModelName`, passed to all three `AssistantRuntime` construction sites (offline, gemini/openai-compatible, session-scoped runtime).
- Hosts: Node pilot (`startPilotServer`), local pilot (`startLocalPilotServer`) and `shortlet-pilot-do.ts` pass `onAssistantTurn` as one `console.log` JSON line. The pilot hosts pass `assistantModelName` from `configuration.concierge.primary?.model`.
- No OpenTelemetry SDK dependency. No new dependency.

## Acceptance criteria

1. Every `AssistantRuntime` that `createGuestRequestHandler` builds receives the turn-record sink, at the offline, provider and session-scoped construction sites, and each host that serves assistant traffic (Node pilot, local pilot, Cloudflare Durable Object) supplies the sink.
2. Each turn record uses the OTel GenAI names `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.tool.name` and `error.type` where the turn has the value, and its keys are exactly the closed allow-list.
3. A turn record contains only allow-listed fields: a turn with personal data in the guest text, the tool arguments, the tool results and the reply writes none of that data.
4. Each turn writes exactly one record, including a turn refused before the planner loop and a turn whose planner fails.
5. Each record carries a fresh run id (UUID v4) that is distinct on every turn and is not a thread, booking, payment, guest or session id.
6. A sink or mapper that throws never changes the turn's response; the failure is counted on `turnRecordDropCount`.
7. Token usage is the sum of the planner calls that reported usage, and is absent when no call reported usage.
8. A tool name the planner proposes that no pack registers is counted and never written to the record.

## Test plan (triage)

- `test/assistant-turn-record.test.ts`: the mapper and runtime criteria (1 to 6), assistant enabled, a cold restore (`LocalGuestApp` over the same store) before each turn, staging-like clock 2026-10-27, staging-like guest.
- `test/assistant-turn-record-hosts.test.ts`: host-level tests for the Node pilot and the local pilot (`console.log` capture, `/api/turn`).
- `apps/cloudflare/test/*.spec.ts`: Durable Object host path, if a spec can drive a turn; otherwise a source-level wiring check is recorded as a gap.

## Comments

### Triage (28 Oct 2026, implementer)

Decisions recorded in "Triage decisions" above; acceptance criteria finalised from the draft (draft 1 is now criteria 1 and 2 with the host test; draft 3 is criterion 3; draft 4 became criterion 5, since one record per turn replaces per-event correlation; criteria 4 and 6 are new). Status set to `ready-for-agent`.

### Implementation (integration/concierge-controls, 28 Oct 2026). Status left at `ready-for-agent`.

ADRs read and applied (ADR table; each constraint is reflected in code and tests):

| ADR | Constraint | Code path / test |
|---|---|---|
| 0079 | Redacted metrics; one record per turn | `assistant-turn-record.ts` (record shape); `AssistantRuntime.handleTurn` wrapper writes one record in `finally`; tests AC4 |
| 0075 | No prompt, reply, tool args/results, guest text or identity in logs; untrusted model/tool content | Record built by name only (allow-list by construction); test AC3 feeds canaries through guest text, tool args, reply text and asserts absence; `ALLOWED_KEYS` check |
| 0070 | Run id is not a domain id; one run per turn | `crypto.randomUUID()` per `handleTurn`; test AC5 asserts UUID v4, distinct per turn, not thread/guest/tenant id |
| 0095 | Workers Logs as sink; retention provisional | `writeAssistantTurnRecord` (console JSON) used by `shortlet-pilot-do.ts` and both Node pilots |
| 0106 | Closed codes and counts only | Outcome, stop reason, failure class and `error.type` are closed values; the error message is never written (test AC1 failure path) |

What changed:
- New `apps/local-guest/src/assistant/assistant-turn-record.ts`: `AssistantTurnRecord` type, `AssistantTurnRun` (per-turn accumulator, forwards every diagnostic unchanged), `writeAssistantTurnRecord` (the host sink).
- `assistant-runtime.ts`: `handleTurn` is now a wrapper around the unchanged turn body (`#runTurnBody`); the body's `#diagnose`/model calls go through the run (`run.diagnose`, `#generatePlan`). Record written once in `finally`; sink or mapper failure swallowed and counted on `turnRecordDropCount`. New options `onTurnRecord`, `modelName`. `#isRegisteredToolName` = pack tool names plus platform task tools. No behaviour change to answers.
- `guest-server.ts`: `onAssistantTurn` and `assistantModelName` options on `createGuestRequestHandler`, passed to all three `AssistantRuntime` sites (offline, provider, session-scoped). Model name falls back to the environment's primary model when no client is injected.
- Hosts: `pilot-server.ts` (`onAssistantTurn`, `assistantModelName` from `configuration.concierge.primary?.model`), `local-pilot-server.ts` (`onAssistantTurn`), `shortlet-pilot-do.ts` (`onAssistantTurn`, `assistantModelName`).

Gaps (not hidden):
- Durable Object host path has no turn-level test: `wrangler.test.jsonc` sets `CONCIERGE_MODE: "deterministic"`, so no assistant runtime runs under Worker tests. Needs an owner decision (an assistant-enabled test binding).
- The planner-throws-out-of-`handleTurn` path (`threw: true`, `runtime_exception`) is implemented but not separately tested; the test covers the planner failure that the loop catches.
- Scope classifier model calls are not counted in usage (documented decision).
- `startLocalGuestServer` (local guest demo, not a pilot host) does not pass `onAssistantTurn`. Owner decision.
- Gemini adapter reports no usage today; counts are absent for Gemini turns.

Commands and counts (all `env -u LLM_API_KEY`; NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow for tsx runs):
- `npm run check`: exit 0 (tsc root, apps/cloudflare, tsconfig.test, tsconfig.tooling, worker bundle guard).
- `npx tsx --test test/assistant-turn-record.test.ts`: 7 tests, 7 pass.
- `npx tsx --test test/assistant-turn-record-hosts.test.ts`: 5 tests, 5 pass (offline, provider and session-scoped sites; Node pilot; local pilot).
- Affected set: `npx tsx --test test/assistant-turn-record.test.ts test/assistant-turn-record-hosts.test.ts test/guest-request-host-packs.test.ts test/assistant-host-composition.test.ts test/guest-request-handler.test.ts test/assistant-turn-stop-reasons.test.ts test/assistant-turn-stop-cold-restore.test.ts test/assistant-control-metrics.test.ts test/assistant-control-outcome-count.test.ts test/assistant-recorded-journeys.test.ts test/assistant-cold-journey.test.ts test/shortlet-assistant-evals.test.ts test/pilot-production-composition.test.ts`: 130 tests, 130 pass, 0 fail.
- `npm run test:assistant`: 67 tests, 67 pass, 0 fail.
- `npm run test:workers -- apps/cloudflare/test/pilot-worker.spec.ts`: 1 file, 4 tests, 4 pass.

Definition of Done:
1. Every AC has a dedicated named test: met for AC1 (host tests), AC2 (`uses the OTel GenAI names...`), AC3, AC4, AC5, AC6, AC7, AC8. AC1 for the Durable Object is not met (gap above).
2. Failure paths: met (sink throws, planner fails, refused pre-loop, unregistered tool name, no usage reported).
3. ADRs listed and cited above: met.
4. No unused injected dependency: met (`onTurnRecord`, `modelName` used at each construction site; `AssistantTurnRun` forwards all events).
5. No invented policy: met (no thresholds added; closed codes only). The `runtime_exception` error type string is a new label; flagged here.
6. No credential or restricted identity in logs: met (test AC3 and the allow-list).
7. Full `npm test` with zero failures: NOT run; it is the once-per-batch pre-merge gate (AGENTS Test scope), so it stays open.

Status stays `ready-for-agent` because DoD item 7 is open for the batch gate and the Durable Object AC1 gap needs an owner decision.
