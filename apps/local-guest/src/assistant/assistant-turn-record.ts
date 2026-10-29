import type { AssistantModelResponse } from "./assistant-model.js";
import type { AssistantControlOutcome } from "./assistant-platform.js";
import type { AssistantDiagnosticEvent, AssistantFailureClass, AssistantStopReason, AssistantTurnOutput } from "./assistant-runtime.js";

// Issue 05 (ADR 0079 redacted metrics, ADR 0075 minimisation, ADR 0070 separate run identity, ADR 0106 closed codes).
// One record per assistant turn, written by the host through `onTurnRecord`. Every field is written by name below: the
// record is an allow-list by construction, so prompts, replies, tool arguments and results, guest text and identities
// have no path into it. Names follow the OpenTelemetry GenAI conventions where a per-turn value exists; the list and the
// assistant.* counts are ours (see the shape notes on AssistantTurnRecord).

export const ASSISTANT_TURN_RECORD_EVENT = "assistant.turn.v1";

/**
 * The closed set the record's `error.type` may take (issue 05 review). These are the refusal codes `AssistantRuntime.handleTurn`
 * can return, plus `THREAD_BUSY` (issue 06), `runtime_exception` for a turn that threw, and `other_refusal` for any other code.
 */
export const ASSISTANT_TURN_ERROR_TYPES = [
  "ACTION_NOT_AUTHORIZED",
  "ACTIVE_TASK",
  "ARTIFACT_MISMATCH",
  "CONCIERGE_UNAVAILABLE",
  "INVALID_ARTIFACT",
  "INVALID_CONTEXT",
  "PAYMENT_NOT_CONFIRMED",
  "STALE_SURFACE",
  "THREAD_BUSY",
  "UNKNOWN_DOMAIN",
  "UNKNOWN_TASK",
  "UNKNOWN_THREAD",
  "UNSUPPORTED_ACTION",
  "UNSUPPORTED_EVENT",
  "runtime_exception",
  "other_refusal",
] as const;
export type AssistantTurnErrorType = typeof ASSISTANT_TURN_ERROR_TYPES[number];

/** The record's error type for a refusal code: a code in the closed set, or `other_refusal`. */
function errorTypeFor(code: string): AssistantTurnErrorType {
  return (ASSISTANT_TURN_ERROR_TYPES as readonly string[]).includes(code) ? code as AssistantTurnErrorType : "other_refusal";
}

/** A token count counts only when it is a non-negative safe integer. Anything else is treated as not reported, never as zero. */
function validTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * One record per chat turn that reaches `AssistantRuntime.handleTurn`. Turns refused earlier by the app layer (for example
 * `INVALID_THREAD`, or an empty or over-long message) write no record; the owner accepted that scope (issue 05).
 *
 * Shape notes:
 * - `assistant.tool_names` is the list of distinct registered tool names the planner proposed this turn, in first-proposed
 *   order. OpenTelemetry's `gen_ai.tool.name` means one name per tool execution; this record is per turn, so the list has
 *   its own name. Arguments and results are never written.
 * - Token counts are sums over the planner and post-cap summary calls that reported a valid count (a non-negative safe
 *   integer). The scope classifier's own model calls are not counted (documented gap, issue 05).
 * - `error.type` is one value from ASSISTANT_TURN_ERROR_TYPES. A message is never written.
 */
export interface AssistantTurnRecord {
  readonly event: typeof ASSISTANT_TURN_RECORD_EVENT;
  /** A fresh run id per turn (ADR 0070): never a thread, booking, payment, guest, session or tenant id. */
  readonly "assistant.turn_id": string;
  readonly "gen_ai.operation.name": "chat";
  /** The configured primary model id the host supplied. A fallback-served call is not distinguished. */
  readonly "gen_ai.request.model"?: string;
  /** Sum over the planner and summary calls that reported a valid usage count. Absent when none did. */
  readonly "gen_ai.usage.input_tokens"?: number;
  readonly "gen_ai.usage.output_tokens"?: number;
  /** Distinct registered tool names the planner proposed, in first-proposed order. Never arguments or results. */
  readonly "assistant.tool_names"?: readonly string[];
  readonly "assistant.planner_calls": number;
  readonly "assistant.tool_calls": number;
  /** Proposed tool calls whose name no registered pack or platform tool owns. The name itself is never written. */
  readonly "assistant.unknown_tool_calls": number;
  readonly "assistant.stop_reason"?: AssistantStopReason;
  readonly "assistant.control_outcome"?: AssistantControlOutcome;
  readonly "assistant.failure_class"?: AssistantFailureClass;
  readonly "error.type"?: AssistantTurnErrorType;
  /** Absent when the clock could not be read at the start or the end of the turn. Never zero for an unknown duration. */
  readonly "assistant.duration_ms"?: number;
}

export interface AssistantTurnRunOptions {
  readonly runId: string;
  /** Undefined when the clock could not be read at the start of the turn. */
  readonly startedAtMs: number | undefined;
  /** Receives every diagnostic event unchanged, as `onDiagnostic` always has. */
  readonly forward: (event: AssistantDiagnosticEvent) => void;
  /** True for a tool name that a registered pack or the platform owns. */
  readonly isRegisteredTool: (name: string) => boolean;
}

/** The facts of one turn, collected while the turn runs and turned into one record when it ends. */
export class AssistantTurnRun {
  readonly #runId: string;
  readonly #startedAtMs: number | undefined;
  readonly #forward: (event: AssistantDiagnosticEvent) => void;
  readonly #isRegisteredTool: (name: string) => boolean;
  #failureClass: AssistantFailureClass | undefined;
  #plannerCalls = 0;
  #toolCalls = 0;
  #unknownToolCalls = 0;
  readonly #toolNames: string[] = [];
  #inputTokens: number | undefined;
  #outputTokens: number | undefined;

  constructor(options: AssistantTurnRunOptions) {
    this.#runId = options.runId;
    this.#startedAtMs = options.startedAtMs;
    this.#forward = options.forward;
    this.#isRegisteredTool = options.isRegisteredTool;
  }

  /** Forwards the event unchanged and keeps the latest closed failure class for the record. */
  diagnose(event: AssistantDiagnosticEvent): void {
    if (event.failureClass !== undefined) this.#failureClass = event.failureClass;
    this.#forward(event);
  }

  /** Counts a planner or summary call when it starts, so a call that fails still counts. */
  startPlannerCall(): void {
    this.#plannerCalls += 1;
  }

  /** Records what a planner or summary response proposed (names only) and the usage it reported, when it reported a valid count. */
  recordResponse(response: AssistantModelResponse): void {
    const calls = response.toolCalls ?? [];
    this.#toolCalls += calls.length;
    for (const call of calls) {
      if (!this.#isRegisteredTool(call.name)) {
        this.#unknownToolCalls += 1;
        continue;
      }
      if (!this.#toolNames.includes(call.name)) this.#toolNames.push(call.name);
    }
    const input = validTokenCount(response.usage?.promptTokens);
    const output = validTokenCount(response.usage?.completionTokens);
    if (input !== undefined) this.#inputTokens = (this.#inputTokens ?? 0) + input;
    if (output !== undefined) this.#outputTokens = (this.#outputTokens ?? 0) + output;
  }

  /**
   * The one record of this turn. `output` is the turn's answer, or undefined when the turn threw. The duration is written
   * only when both clock readings are known.
   */
  toRecord(input: { readonly modelName?: string; readonly output?: AssistantTurnOutput; readonly threw: boolean; readonly endedAtMs?: number }): AssistantTurnRecord {
    const { output } = input;
    const refusalCode = output && output.ok === false ? output.code : undefined;
    const errorType = input.threw ? "runtime_exception" : refusalCode === undefined ? undefined : errorTypeFor(refusalCode);
    const durationMs = this.#startedAtMs === undefined || input.endedAtMs === undefined
      ? undefined
      : Math.max(0, Math.round(input.endedAtMs - this.#startedAtMs));
    return {
      event: ASSISTANT_TURN_RECORD_EVENT,
      "assistant.turn_id": this.#runId,
      "gen_ai.operation.name": "chat",
      ...(input.modelName ? { "gen_ai.request.model": input.modelName } : {}),
      ...(this.#inputTokens === undefined ? {} : { "gen_ai.usage.input_tokens": this.#inputTokens }),
      ...(this.#outputTokens === undefined ? {} : { "gen_ai.usage.output_tokens": this.#outputTokens }),
      ...(this.#toolNames.length === 0 ? {} : { "assistant.tool_names": [...this.#toolNames] }),
      "assistant.planner_calls": this.#plannerCalls,
      "assistant.tool_calls": this.#toolCalls,
      "assistant.unknown_tool_calls": this.#unknownToolCalls,
      ...(output?.stopReason === undefined ? {} : { "assistant.stop_reason": output.stopReason }),
      ...(output?.controlOutcome === undefined ? {} : { "assistant.control_outcome": output.controlOutcome }),
      ...(this.#failureClass === undefined ? {} : { "assistant.failure_class": this.#failureClass }),
      ...(errorType === undefined ? {} : { "error.type": errorType }),
      ...(durationMs === undefined ? {} : { "assistant.duration_ms": durationMs }),
    };
  }
}

/** The host's sink for Workers Logs and the Node pilot: one JSON line per turn, through the console. */
export function writeAssistantTurnRecord(record: AssistantTurnRecord): void {
  console.log(JSON.stringify(record));
}
