import type { AssistantModelResponse } from "./assistant-model.js";
import type { AssistantControlOutcome } from "./assistant-platform.js";
import type { AssistantDiagnosticEvent, AssistantFailureClass, AssistantStopReason, AssistantTurnOutput } from "./assistant-runtime.js";

// Issue 05 (ADR 0079 redacted metrics, ADR 0075 minimisation, ADR 0070 separate run identity, ADR 0106 closed codes).
// One record per assistant turn, written by the host through `onTurnRecord`. Every field is written by name below: the
// record is an allow-list by construction, so prompts, replies, tool arguments and results, guest text and identities
// have no path into it. Names follow the OpenTelemetry GenAI conventions where a per-turn value exists. The shape choices
// are documented in the issue: `gen_ai.tool.name` is a list of distinct names, and `assistant.*` counts and codes are ours.

export const ASSISTANT_TURN_RECORD_EVENT = "assistant.turn.v1";

/** One closed JSON record per turn. Absent keys mean the turn had no such value. */
export interface AssistantTurnRecord {
  readonly event: typeof ASSISTANT_TURN_RECORD_EVENT;
  /** A fresh run id per turn (ADR 0070): never a thread, booking, payment, guest, session or tenant id. */
  readonly "assistant.turn_id": string;
  readonly "gen_ai.operation.name": "chat";
  /** The configured primary model id the host supplied. A fallback-served call is not distinguished. */
  readonly "gen_ai.request.model"?: string;
  /** Sum over the planner and summary calls that the provider reported usage for. Absent when none reported it. */
  readonly "gen_ai.usage.input_tokens"?: number;
  readonly "gen_ai.usage.output_tokens"?: number;
  /** Distinct registered tool names the planner proposed, in first-proposed order. Never arguments or results. */
  readonly "gen_ai.tool.name"?: readonly string[];
  readonly "assistant.planner_calls": number;
  readonly "assistant.tool_calls": number;
  /** Proposed tool calls whose name no registered pack owns. The name itself is never written. */
  readonly "assistant.unknown_tool_calls": number;
  readonly "assistant.stop_reason"?: AssistantStopReason;
  readonly "assistant.control_outcome"?: AssistantControlOutcome;
  readonly "assistant.failure_class"?: AssistantFailureClass;
  /** The closed refusal code of a refused turn, or `runtime_exception` when the turn threw. Never a message. */
  readonly "error.type"?: string;
  readonly "assistant.duration_ms": number;
}

export interface AssistantTurnRunOptions {
  readonly runId: string;
  readonly startedAtMs: number;
  /** Receives every diagnostic event unchanged, as `onDiagnostic` always has. */
  readonly forward: (event: AssistantDiagnosticEvent) => void;
  /** True for a tool name that a registered pack or the platform owns. */
  readonly isRegisteredTool: (name: string) => boolean;
}

/** The facts of one turn, collected while the turn runs and turned into one record when it ends. */
export class AssistantTurnRun {
  readonly #runId: string;
  readonly #startedAtMs: number;
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

  /** Records what a planner or summary response proposed (names only) and the usage it reported, when it reported any. */
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
    if (response.usage) {
      this.#inputTokens = (this.#inputTokens ?? 0) + response.usage.promptTokens;
      this.#outputTokens = (this.#outputTokens ?? 0) + response.usage.completionTokens;
    }
  }

  /** The one record of this turn. `output` is the turn's answer, or undefined when the turn threw. */
  toRecord(input: { readonly modelName?: string; readonly output?: AssistantTurnOutput; readonly threw: boolean; readonly endedAtMs: number }): AssistantTurnRecord {
    const { output } = input;
    const refusalCode = output && output.ok === false ? output.code : undefined;
    const errorType = input.threw ? "runtime_exception" : refusalCode;
    return {
      event: ASSISTANT_TURN_RECORD_EVENT,
      "assistant.turn_id": this.#runId,
      "gen_ai.operation.name": "chat",
      ...(input.modelName ? { "gen_ai.request.model": input.modelName } : {}),
      ...(this.#inputTokens === undefined ? {} : { "gen_ai.usage.input_tokens": this.#inputTokens }),
      ...(this.#outputTokens === undefined ? {} : { "gen_ai.usage.output_tokens": this.#outputTokens }),
      ...(this.#toolNames.length === 0 ? {} : { "gen_ai.tool.name": [...this.#toolNames] }),
      "assistant.planner_calls": this.#plannerCalls,
      "assistant.tool_calls": this.#toolCalls,
      "assistant.unknown_tool_calls": this.#unknownToolCalls,
      ...(output?.stopReason === undefined ? {} : { "assistant.stop_reason": output.stopReason }),
      ...(output?.controlOutcome === undefined ? {} : { "assistant.control_outcome": output.controlOutcome }),
      ...(this.#failureClass === undefined ? {} : { "assistant.failure_class": this.#failureClass }),
      ...(errorType === undefined ? {} : { "error.type": errorType }),
      "assistant.duration_ms": Math.max(0, Math.round(input.endedAtMs - this.#startedAtMs)),
    };
  }
}

/** The host's sink for Workers Logs and the Node pilot: one JSON line per turn, through the console. */
export function writeAssistantTurnRecord(record: AssistantTurnRecord): void {
  console.log(JSON.stringify(record));
}
