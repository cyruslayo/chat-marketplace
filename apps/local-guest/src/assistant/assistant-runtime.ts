import type { A2UIServerMessage } from "@cylayo/weaver-core";
import type { CommandPrincipal } from "../../../../packages/platform-core/src/index.js";
import type { LocalGuestEnvironment } from "../fixture.js";
import type {
  AssistantConversationStep,
  AssistantModelClient,
  AssistantToolCall,
  AssistantToolResult,
  AssistantModelResponse,
} from "./assistant-model.js";
import { ModelRequestGuardError } from "./assistant-model.js";
import { findToolArgumentViolation, toolArgumentFailureMessage } from "./assistant-tool-arguments.js";
import {
  AssistantPackRegistry,
  composeSystemInstruction,
  MAX_ASSISTANT_TOOL_ROUNDS,
  PLATFORM_TASK_TOOLS,
  PLATFORM_TASK_TOOL_NAMES,
  TASK_START_EVENT,
  TASK_SWITCH_EVENT,
  toolsForValidatedIntents,
  toolNamesForValidatedIntents,
  type AssistantDomainPack,
  type AssistantTaskSummary,
  type AssistantToolContext,
  type AssistantReplyPlan,
  type AssistantReplyPlanKind,
} from "./assistant-platform.js";
import { createShortletAssistantPack, validatedCheckOutForNights } from "./shortlet-assistant-pack.js";
import { AssistantDateProvenanceError, AssistantDateValidationError, AssistantStayDetailsError, containsGuestDate, currentTurnDateRoles } from "./date-tokens.js";
import { PLANNER_REQUEST_TIMEOUT_MS, SERVER_TURN_MAX_MS } from "../turn-budget.js";
import { ModelScopeClassifier, ScopeClassificationError, assessScopeSafely, scopedMixedInput, type ScopeClassifier, type ScopeAssessment, type ConciergeIntent } from "./scope-classifier.js";
import { RetryingScopeClassifier, ScopeClassifierRetryError, SCOPE_TOTAL_BUDGET_MS, type ScopeClassifierRetryEvent, type ScopeClassifierRetryResult } from "./scope-classifier-retry.js";
import { ASSISTANT_CONTROL_COPY } from "./control-copy.js";
import { isProviderUnavailable } from "./fallback-model-client.js";
import { searchAreaFor } from "../concierge.js";
import {
  cloneTaskState,
  createInitialTaskState,
  type AssistantTask,
  type AssistantTaskState,
  type AssistantThreadState,
  type AssistantTurnSurface,
  replacePendingProposal,
  type AssistantStayReference,
} from "./assistant-state.js";
import { TurnTransaction, syncActiveTask } from "./assistant-turn-transaction.js";
import type { AssistantControlOutcome, AssistantToolEffectCode } from "./assistant-platform.js";
import {
  PENDING_ACTION_STAGE,
  type AssistantStageHandler,
  type PendingActionOutcome,
  type StageProjection,
  type StageToolExecution,
  type StageTurnContext,
} from "./assistant-stage-handler.js";
import { proposalStillAuthorised } from "./shortlet-stage-handlers.js";

import {
  isExplicitConfirmation,
  isExplicitCancellation,
  type PendingAssistantAction,
} from "./pending-actions.js";
import {
  ASSISTANT_CONFIRM_ACTION_EVENT,
  ASSISTANT_CANCEL_ACTION_EVENT,
} from "./pending-action-a2ui.js";
import { redactSensitiveData } from "../../../../packages/platform-core/src/redaction.js";

export { ASSISTANT_CONTROL_OUTCOMES, type AssistantControlOutcome, type AssistantToolEffectCode } from "./assistant-platform.js";

/**
 * Why a planner turn stopped (issue 02). Present on a turn that reached the planner loop; scope redirects and
 * deterministic confirmations never reach it and carry no stop reason.
 * - `reply`: the model answered without tool calls.
 * - `round_limit`: the round cap was reached and the summary call made the reply.
 * - `turn_deadline`: the whole-turn deadline was reached before the turn's next model call.
 * - `tool_denial`: a planner date or stay detail the guest did not give was rejected; the turn returns a dated
 *   clarification (ok: true) and commits no task state. Not a failure: the guest is asked for the detail.
 * - `error`: a failure path (the failure class stays on the diagnostics).
 *
 * `turn_stop` diagnostics follow the same list. `succeeded` is true for `reply`, `round_limit` and `tool_denial`, and
 * false for `turn_deadline` and `error`.
 *
 * `rejected_plan_fallback` (controlOutcome) is not a stop reason. It marks a turn that returned the projected-operation
 * fallback, and the stop reason records how the loop ended:
 * - a reply with a rejected plan (legacy prose or invalid references) is `reply`, succeeded;
 * - a rejected planner date or stay detail after a successful operation with a surface is `tool_denial`, succeeded, with
 *   controlOutcome `rejected_plan_fallback` and the operation's surfaces returned (the fallback runs before the
 *   clarification branch; see the test "a rejected date after a successful operation...");
 * - a failure or the turn deadline after a successful operation with a surface is `error` or `turn_deadline`, not succeeded.
 *
 * `turn_stop` covers planner turns only. Scope redirects, unavailable scope, cross-domain routing and deterministic
 * confirmations exit before the planner loop and emit none.
 */
export type AssistantStopReason = "reply" | "round_limit" | "turn_deadline" | "tool_denial" | "error";

export interface AssistantTurnOutput {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly messages?: readonly string[];
  readonly surfaces?: readonly AssistantTurnSurface[];
  readonly tasks?: readonly AssistantTaskRailEntry[];
  readonly modelHandled?: boolean;
  readonly providerUnavailable?: boolean;
  readonly discardUserInput?: boolean;
  readonly controlOutcome?: AssistantControlOutcome;
  readonly stopReason?: AssistantStopReason;
}

/** A task's entry in the shell rail, derived from the active pack's `taskSummary`. */
export interface AssistantTaskRailEntry {
  readonly taskId: string;
  readonly domain: string;
  readonly domainLabel: string;
  readonly status: string;
  readonly tone?: AssistantTaskSummary["tone"];
  readonly active: boolean;
  readonly badge?: number;
}

/** A registered vertical offered by a starter card. */
export interface AssistantVertical {
  readonly domain: string;
  readonly label: string;
  readonly description?: string;
}

export type AssistantDiagnosticStage =
  | "provider_request"
  | "provider_response"
  | "application_operation"
  | "projection"
  | "a2ui"
  | "weaver"
  | "tool_execution"
  | "function_result_round_trip"
  /** Issue 02: one closed event per planner turn that reached the planner loop, carrying its stop reason. */
  | "turn_stop";

export type AssistantFailureClass =
  | "PROVIDER_TRANSPORT_FAILURE"
  | "MODEL_SELECTION_FAILURE"
  | "INVALID_TOOL_FOR_STATE"
  | "APPLICATION_OPERATION_FAILURE"
  | "PROJECTION_FAILURE"
  | "A2UI_FAILURE"
  | "WEAVER_FAILURE"
  /** ADR 0106: a local product quota refusal, reported as a control outcome and never as a model or provider fault. */
  | "QUOTA_REFUSED";


export interface AssistantDiagnosticEvent {
  readonly stage: AssistantDiagnosticStage;
  readonly round: number;
  readonly succeeded: boolean;
  readonly toolName?: string;
  readonly resultCount?: number;
  readonly errorClass?: string;
  readonly providerStatusCode?: number;
  readonly providerErrorCode?: string;
  readonly failureClass?: AssistantFailureClass;
  readonly outcome?: AssistantControlOutcome;
  readonly effectCode?: AssistantToolEffectCode;
  readonly scopeFailureReason?: import("./scope-classifier.js").ScopeFailureReason;
  /** ADR 0106 amendment: classifier attempts that started for this stage (1 or 2). Closed count only. */
  readonly classifierAttempts?: 1 | 2;
  /** ADR 0106 amendment: the closed code of the first classifier attempt when it failed validation. Never classifier text. */
  readonly firstAttemptScopeFailureReason?: import("./scope-classifier.js").ScopeFailureReason;
  /** ADR 0106 amendment: how the retry stage ended. Present only when a first attempt failed validation. */
  readonly classifierRetryResult?: ScopeClassifierRetryResult;
  /** ADR 0106 amendment, metadata only: the closed finish reason of the failed classifier response, recorded beside its code. Never changes acceptance or retry. */
  readonly finishReason?: import("./assistant-model.js").AssistantFinishReason;
  /** Metadata only: the closed finish reason of the first failed classifier attempt when a retry stage ran. */
  readonly firstAttemptFinishReason?: import("./assistant-model.js").AssistantFinishReason;
  /** ADR 0075 / 0106: a fixed rejection code for a reply plan; the rejected text is never recorded. */
  readonly replyPlanRejectionReason?: ReplyPlanRejectionReason;
  /** Issue 02: the closed stop reason, on the `turn_stop` event. */
  readonly stopReason?: AssistantStopReason;
}

export type ReplyPlanRejectionReason = "empty_text" | "unexpected_tool_calls" | "not_json" | "not_object" | "invalid_shape"
  | "unknown_kind" | "invalid_references" | "reference_not_in_results";

export interface AssistantRuntimeOptions {
  readonly onDiagnostic?: (event: AssistantDiagnosticEvent) => void;
  /** Additional domain packs to register (used by hosts that host more than one domain). */
  readonly additionalPacks?: readonly AssistantDomainPack[];
  /** Maximum tokens for a final reply plan; engineering bound configured by the host. */
  readonly maxReplyOutputTokens?: number;
  readonly maxPlanningOutputTokens?: number;
  readonly scopeClassifier?: ScopeClassifier;
  readonly scopeTimeoutMs?: number;
  readonly scopeReasoningEffort?: "none" | "provider_default";
  readonly maxInputCharacters?: number;
  /** Engineering bounds on retained model context; packs supply the canonical state summary. */
  readonly maxHistorySteps?: number;
  readonly maxHistoryCharacters?: number;
  /** Maximum projected result/reference items retained in model context. */
  readonly maxContextItems?: number;
  /** Timeout for one planner request and for the post-cap summary call (issue 02, engineering setting). */
  readonly modelCallTimeoutMs?: number;
  /** Whole-turn limit, measured from the start of the turn on the environment clock (issue 02, ADR 0079). */
  readonly turnDeadlineMs?: number;
}

export interface AssistantShortletRestoreInput {
  readonly principalId: string;
  readonly tenantId: string;
  readonly taskState: AssistantTaskState;
  readonly canonicalUserFacts: readonly string[];
  /**
   * Issue 03 follow-up (ADR 0106): the pending confirmation's surface id the guest holds, restored with the pending action so
   * its button events stay authorised under the same id. Ignored unless it names the restored action.
   */
  readonly pendingActionSurfaceId?: string;
  /** ADR 0106: the shell's rebuilt discovery artifact, keyed to the id the guest's card holds. */
  readonly discoveryArtifact?: { readonly id: string };
}

interface AssistantEventContext {
  readonly actionId?: unknown;
  readonly threadId?: unknown;
  readonly surfaceId?: unknown;
  readonly taskId?: unknown;
  readonly domain?: unknown;
  readonly proposalId?: unknown;
  readonly expectedVersion?: unknown;
  readonly cartVersion?: unknown;
  readonly confirmedTotalKobo?: unknown;
}

export const DEFAULT_ASSISTANT_REPLY_MAX_OUTPUT_TOKENS = 128;
export const DEFAULT_ASSISTANT_PLANNING_MAX_OUTPUT_TOKENS = 1024;
export const DEFAULT_ASSISTANT_HISTORY_MAX_STEPS = 32;
export const DEFAULT_ASSISTANT_HISTORY_MAX_CHARACTERS = 24_000;
export const DEFAULT_ASSISTANT_CONTEXT_MAX_ITEMS = 8;
const MAX_ASSISTANT_HISTORY_STEPS = 512;
const MAX_ASSISTANT_HISTORY_CHARACTERS = 262_144;
const MAX_ASSISTANT_CONTEXT_ITEMS = 128;
const MAX_ASSISTANT_REPLY_OUTPUT_TOKENS = 4096;
/** Issue 02: the planner request timeout the runtime has always used (turn-budget.ts). Bounds one provider request. */
export const DEFAULT_ASSISTANT_MODEL_CALL_TIMEOUT_MS = PLANNER_REQUEST_TIMEOUT_MS;
/**
 * Whole-turn limit, applied to one planner turn: the scope stage, every planner request and the summary call, measured
 * from the start of the turn. Owner decision (issue 02 Comments): it equals the server turn budget `SERVER_TURN_MAX_MS`
 * (turn-budget.ts, 168 s), the longest a server turn can run under ADR 0106, rather than a separate literal. It is not
 * `DEFAULT_MODEL_REQUEST_DEADLINE_MS` in model-quota-guard.ts, which bounds one provider request.
 */
export const DEFAULT_ASSISTANT_TURN_DEADLINE_MS = SERVER_TURN_MAX_MS;
/** Accepted range for both runtime limits, the same engineering bounds as the model quota guard's request deadline. */
const MIN_ASSISTANT_RUNTIME_LIMIT_MS = 1_000;
const MAX_ASSISTANT_RUNTIME_LIMIT_MS = 300_000;

/** Thrown before a model call that would start after the turn deadline. Caught by `handleTurn` only. */
class AssistantTurnDeadlineError extends Error {
  constructor() {
    super("turn_deadline");
    this.name = "AssistantTurnDeadlineError";
  }
}
/** ADR 0106: references name tools whose results this turn produced. The parser stays the authority; the enum only narrows the provider output. */
function replyPlanSchema(referenceNames: readonly string[]): Record<string, unknown> {
  const names = [...new Set(referenceNames)];
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["show_results", "show_details", "compare", "explain_price", "show_status", "propose_action", "clarify_stay", "redirect", "support_guidance"] },
      // With no successful tool result yet, no name is valid; the parser then rejects any non-empty list.
      references: { type: "array", items: names.length > 0 ? { type: "string", enum: names } : { type: "string" } },
    },
    required: ["kind", "references"],
    additionalProperties: false,
  };
}

function successfulToolNames(results: readonly AssistantToolResult[]): string[] {
  return results.filter((result) => !result.isError).map((result) => result.name);
}

/** Returns the validated plan, or the closed code for the first rule the reply failed. `results` must be every successful result of the turn. */
function parseReplyPlan(response: AssistantModelResponse, results: readonly AssistantToolResult[]): AssistantReplyPlan | ReplyPlanRejectionReason {
  if (response.toolCalls?.length) return "unexpected_tool_calls";
  if (!response.text) return "empty_text";
  let value: unknown;
  try { value = JSON.parse(response.text); } catch { return "not_json"; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "not_object";
  const record = value as Record<string, unknown>;
  const kinds: readonly AssistantReplyPlanKind[] = ["show_results", "show_details", "compare", "explain_price", "show_status", "propose_action", "clarify_stay", "redirect", "support_guidance"];
  if (Object.keys(record).length !== 2) return "invalid_shape";
  if (typeof record.kind !== "string" || !kinds.includes(record.kind as AssistantReplyPlanKind)) return "unknown_kind";
  if (!Array.isArray(record.references) || !record.references.every((item) => typeof item === "string")) return "invalid_references";
  const allowed = new Set(results.filter((result) => !result.isError).map((result) => result.name));
  if (record.references.some((reference) => !allowed.has(reference))) return "reference_not_in_results";
  return { kind: record.kind as AssistantReplyPlanKind, references: record.references as string[] };
}
/** Runs the stage handlers in order; the first handler that claims the execution answers for it. */
function projectWithHandlers(handlers: readonly AssistantStageHandler[], input: StageToolExecution, turn: StageTurnContext): StageProjection | undefined {
  for (const handler of handlers) {
    const projection = handler.project?.(input, turn);
    if (projection) return projection;
  }
  return undefined;
}

export class AssistantRuntime {
  readonly #environment: LocalGuestEnvironment;
  readonly #modelClient: AssistantModelClient;
  readonly #onDiagnostic?: (event: AssistantDiagnosticEvent) => void;
  readonly #maxReplyOutputTokens: number;
  readonly #maxPlanningOutputTokens: number;
  readonly #scopeClassifier: ScopeClassifier;
  readonly #scopeTimeoutMs: number;
  /** The classifier stage's outer race: the per-attempt cap for an injected classifier, the 8 s total for the default retrying path. */
  readonly #scopeOuterTimeoutMs: number;
  readonly #maxInputCharacters: number;
  readonly #maxHistorySteps: number;
  readonly #maxHistoryCharacters: number;
  readonly #maxContextItems: number;
  readonly #modelCallTimeoutMs: number;
  readonly #turnDeadlineMs: number;
  readonly #threads = new Map<string, AssistantThreadState>();
  readonly #packs = new AssistantPackRegistry();

  constructor(environment: LocalGuestEnvironment, modelClient: AssistantModelClient, options: AssistantRuntimeOptions = {}) {
    this.#environment = environment;
    this.#modelClient = modelClient;
    this.#onDiagnostic = options.onDiagnostic;
    const maxReplyOutputTokens = options.maxReplyOutputTokens ?? DEFAULT_ASSISTANT_REPLY_MAX_OUTPUT_TOKENS;
    if (!Number.isSafeInteger(maxReplyOutputTokens) || maxReplyOutputTokens < 1 || maxReplyOutputTokens > MAX_ASSISTANT_REPLY_OUTPUT_TOKENS) {
      throw new Error(`maxReplyOutputTokens must be an integer between 1 and ${MAX_ASSISTANT_REPLY_OUTPUT_TOKENS}`);
    }
    this.#maxReplyOutputTokens = maxReplyOutputTokens;
    const planningLimit = options.maxPlanningOutputTokens ?? DEFAULT_ASSISTANT_PLANNING_MAX_OUTPUT_TOKENS;
    if (!Number.isSafeInteger(planningLimit) || planningLimit < 1 || planningLimit > MAX_ASSISTANT_REPLY_OUTPUT_TOKENS) throw new Error("maxPlanningOutputTokens is invalid");
    this.#maxPlanningOutputTokens = planningLimit;
    this.#scopeTimeoutMs = options.scopeTimeoutMs ?? 5000;
    this.#maxInputCharacters = options.maxInputCharacters ?? 8192;
    this.#maxHistorySteps = options.maxHistorySteps ?? DEFAULT_ASSISTANT_HISTORY_MAX_STEPS;
    this.#maxHistoryCharacters = options.maxHistoryCharacters ?? DEFAULT_ASSISTANT_HISTORY_MAX_CHARACTERS;
    this.#maxContextItems = options.maxContextItems ?? DEFAULT_ASSISTANT_CONTEXT_MAX_ITEMS;
    if (![this.#scopeTimeoutMs, this.#maxInputCharacters].every((value) => Number.isSafeInteger(value) && value > 0)
      || !Number.isSafeInteger(this.#maxHistorySteps) || this.#maxHistorySteps < 2 || this.#maxHistorySteps > MAX_ASSISTANT_HISTORY_STEPS
      || !Number.isSafeInteger(this.#maxHistoryCharacters) || this.#maxHistoryCharacters < 256 || this.#maxHistoryCharacters > MAX_ASSISTANT_HISTORY_CHARACTERS) throw new Error("Scope and history engineering limits are outside configured bounds");
    if (!Number.isSafeInteger(this.#maxContextItems) || this.#maxContextItems < 1 || this.#maxContextItems > MAX_ASSISTANT_CONTEXT_ITEMS) throw new Error("maxContextItems is outside configured bounds");
    this.#modelCallTimeoutMs = options.modelCallTimeoutMs ?? DEFAULT_ASSISTANT_MODEL_CALL_TIMEOUT_MS;
    this.#turnDeadlineMs = options.turnDeadlineMs ?? DEFAULT_ASSISTANT_TURN_DEADLINE_MS;
    const inRuntimeLimitRange = (value: number) => Number.isSafeInteger(value)
      && value >= MIN_ASSISTANT_RUNTIME_LIMIT_MS && value <= MAX_ASSISTANT_RUNTIME_LIMIT_MS;
    if (!inRuntimeLimitRange(this.#modelCallTimeoutMs) || !inRuntimeLimitRange(this.#turnDeadlineMs)) {
      throw new Error(`modelCallTimeoutMs and turnDeadlineMs must be integers between ${MIN_ASSISTANT_RUNTIME_LIMIT_MS} and ${MAX_ASSISTANT_RUNTIME_LIMIT_MS}`);
    }
    if (options.scopeReasoningEffort !== undefined && options.scopeReasoningEffort !== "none" && options.scopeReasoningEffort !== "provider_default") throw new Error("Invalid scope reasoning effort");
    // ADR 0106 amendment: the default path retries an eligible JSON-shape failure once with an identical request.
    // Injected classifiers keep their single attempt and the scope timeout as before.
    this.#scopeClassifier = options.scopeClassifier ?? new RetryingScopeClassifier({
      createAttempt: (timeoutMs) => new ModelScopeClassifier(modelClient, timeoutMs, undefined, options.scopeReasoningEffort),
      firstAttemptTimeoutMs: this.#scopeTimeoutMs,
      onAttempt: (event) => this.#recordClassifierRetry(event),
    });
    this.#scopeOuterTimeoutMs = options.scopeClassifier ? this.#scopeTimeoutMs : SCOPE_TOTAL_BUDGET_MS;
    this.#packs.register(createShortletAssistantPack(environment));
    for (const pack of options.additionalPacks ?? []) this.#packs.register(pack);
  }

  get #activePack(): AssistantDomainPack {
    return this.#packs.active;
  }

  #projectionForTool(name: string, result: Record<string, unknown>): Record<string, unknown> {
    for (const id of this.#packs.ids()) {
      const pack = this.#packs.packFor(id);
      if (pack?.toolNames.includes(name)) return pack.projectToolResult?.(name, result, { maxItems: this.#maxContextItems }) ?? {};
    }
    return {};
  }

  #sanitizeHistory(history: readonly AssistantConversationStep[]): AssistantConversationStep[] {
    const projected = history.map((step): AssistantConversationStep => {
      if (step.role === "user") return { role: "user", text: redactSensitiveData(step.text) as string };
      if (step.role === "assistant") return { role: "assistant", text: "Server reply delivered." };
      if (step.role === "tool_calls") {
        const calls = step.calls.map((call) => ({ id: call.id, name: safeAssistantToolName(call.name, this.#packs), args: redactSensitiveData(call.args) as Record<string, unknown> }));
        const rawStep = step.rawStep === undefined ? undefined : this.#modelClient.projectProviderContinuation?.({ rawStep: step.rawStep }, calls);
        return { role: "tool_calls", calls, ...(rawStep === undefined ? {} : { rawStep }) };
      }
      return { role: "tool_results", results: step.results.map((result) => ({ callId: result.callId, name: safeAssistantToolName(result.name, this.#packs), result: this.#projectionForTool(result.name, result.result), ...(result.isError ? { isError: true } : {}) })) };
    });
    const safe: AssistantConversationStep[] = [];
    for (let index = 0; index < projected.length; index++) {
      const step = projected[index]!;
      if (step.role === "tool_results") continue;
      if (step.role !== "tool_calls") { safe.push(step); continue; }
      const resultStep = projected[index + 1];
      if (resultStep?.role !== "tool_results") continue;
      const results = resultStep.results.filter((result) => step.calls.some((call) => call.id === result.callId && call.name === result.name));
      const calls = step.calls.filter((call) => results.some((result) => result.callId === call.id && result.name === call.name));
      if (calls.length === 0 || results.length === 0) continue;
      const rawStep = step.rawStep === undefined ? undefined : this.#modelClient.projectProviderContinuation?.({ rawStep: step.rawStep }, calls);
      safe.push({ role: "tool_calls", calls, ...(rawStep === undefined ? {} : { rawStep }) }, { role: "tool_results", results });
      index++;
    }
    return safe;
  }

  #commitHistory(thread: AssistantThreadState, history: readonly AssistantConversationStep[], pack: AssistantDomainPack, state: AssistantTaskState): void {
    let retained: readonly AssistantConversationStep[];
    try {
      retained = this.#boundedHistory(this.#sanitizeHistory(history), pack, state);
    } catch {
      // Preserve committed domain state and a minimal server-owned summary when even bounded context cannot fit.
      retained = [{ role: "assistant", text: `Canonical task facts: ${JSON.stringify({ domain: pack.id })}` }];
    }
    thread.conversationHistory.length = 0;
    thread.conversationHistory.push(...retained);
  }

  #boundedHistory(history: readonly AssistantConversationStep[], pack: AssistantDomainPack, state: AssistantTaskState): readonly AssistantConversationStep[] {
    let retained = history.filter((step) => step.role !== "assistant");
    const facts = pack.projectStateSummary?.(state, { maxItems: this.#maxContextItems }) ?? { domain: pack.id };
    const summary: AssistantConversationStep = { role: "assistant", text: `Canonical task facts: ${JSON.stringify(redactSensitiveData(facts))}` };
    const currentUser = [...retained].reverse().find((step) => step.role === "user");
    const exceeds = () => retained.length + 1 > this.#maxHistorySteps || JSON.stringify([summary, ...retained]).length > this.#maxHistoryCharacters;
    while (exceeds()) {
      if (!retained.length || retained[0] === currentUser) throw new Error("The current input and canonical task facts exceed configured history bounds");
      const removed = retained.shift();
      if (removed?.role === "tool_calls" && retained[0]?.role === "tool_results") retained.shift();
      else if (retained[0]?.role === "tool_results") retained.shift();
      if (removed?.role === "user" && removed === currentUser) throw new Error("The current input and canonical task facts exceed configured history bounds");
    }
    return [summary, ...retained];
  }

  #packForThread(threadId: string): AssistantDomainPack {
    const thread = this.#threads.get(threadId);
    const domain = thread ? thread.tasks.find((task) => task.taskId === thread.activeTaskId)?.domain : undefined;
    return (domain ? this.#packs.packFor(domain) : undefined) ?? this.#activePack;
  }

  #isPlatformTaskTool(name: string): boolean {
    return PLATFORM_TASK_TOOL_NAMES.includes(name);
  }

  /** Starts or switches conversation tasks: the previous task's state and workspace are saved and the target's restored. */
  #applyTaskTool(
    name: string,
    args: Record<string, unknown>,
    tasks: AssistantTask[],
    activeTaskId: string,
    currentState: AssistantTaskState,
    workspace: {
      activeSurfaces: Map<string, string>;
      supersededSurfaces: Set<string>;
      lastSurfaces: readonly AssistantTurnSurface[];
    },
  ): {
    state: AssistantTaskState;
    activeTaskId: string;
    workspace: {
      activeSurfaces: Map<string, string>;
      supersededSurfaces: Set<string>;
      lastSurfaces: readonly AssistantTurnSurface[];
    };
    result: Record<string, unknown>;
  } {
    const active = tasks.find((task) => task.taskId === activeTaskId);
    if (active) {
      active.state = currentState;
      active.activeSurfaces = workspace.activeSurfaces;
      active.supersededSurfaces = workspace.supersededSurfaces;
      active.lastSurfaces = workspace.lastSurfaces;
    }

    const restore = (target: AssistantTask): typeof workspace & { state: AssistantTaskState; activeTaskId: string } => {
      // Opening a task consumes its badge (the Guest is now looking at it).
      target.badge = 0;
      return {
        state: cloneTaskState(target.state),
        activeTaskId: target.taskId,
        activeSurfaces: new Map(target.activeSurfaces),
        supersededSurfaces: new Set(target.supersededSurfaces),
        lastSurfaces: target.lastSurfaces,
      };
    };

    if (name === "switch_task") {
      const targetId = typeof args.taskId === "string" ? args.taskId : "";
      const target = tasks.find((task) => task.taskId === targetId);
      if (!target) return { state: currentState, activeTaskId, workspace, result: { error: "UNKNOWN_TASK", message: "That task is not in this conversation." } };
      const restored = restore(target);
      return { state: restored.state, activeTaskId: restored.activeTaskId, workspace: restored, result: { switched: target.taskId, domain: target.domain } };
    }

    const domain = typeof args.domain === "string" ? args.domain : "";
    if (!this.#packs.packFor(domain)) {
      return { state: currentState, activeTaskId, workspace, result: { error: "UNKNOWN_DOMAIN", message: "That domain is not registered." } };
    }
    const existing = tasks.find((task) => task.domain === domain);
    if (existing) {
      const restored = restore(existing);
      return { state: restored.state, activeTaskId: restored.activeTaskId, workspace: restored, result: { started: domain, taskId: existing.taskId } };
    }
    const created: AssistantTask = {
      // ADR 0070/0099: task IDs cross domain storage boundaries (for example, Commerce Cart task_id).
      // Allocate a server-unique ID so separate guests and threads cannot share task-keyed state.
      taskId: `task-${crypto.randomUUID()}`,
      domain,
      state: createInitialTaskState(),
      activeSurfaces: new Map(),
      supersededSurfaces: new Set(),
      lastSurfaces: [],
      badge: 0,
    };
    tasks.push(created);
    return {
      state: createInitialTaskState(),
      activeTaskId: created.taskId,
      workspace: { activeSurfaces: new Map(), supersededSurfaces: new Set(), lastSurfaces: [] },
      result: { started: domain, taskId: created.taskId },
    };
  }

  /**
   * ADR 0074 and the criteria strip: a discovery search that ran outside the planner (a chip edit or undo) replaces the
   * runtime's shortlist, so a later proposal refers to the stays the guest now sees. An open proposal whose stay, unit, dates
   * or party no longer match is removed, exactly as a planner search change removes it.
   */
  applyDiscoveryShortlist(threadId: string, shortlist: readonly AssistantStayReference[], artifact?: { readonly id: string }): boolean {
    if (!this.hasThread(threadId)) return false;
    const thread = this.getThread(threadId);
    const state = thread.taskState;
    // The artifact the strip's results came from: the page rebuild reads it, so a stale one would show the old area's route.
    if (artifact) {
      thread.discoveryArtifactId = artifact.id;
      thread.discoveryArtifact = artifact;
    }
    state.shortlist = shortlist.map((stay) => ({ ...stay, amenities: [...stay.amenities] }));
    if (state.selectedStayRef && !shortlist.some((stay) => stay.stayRef === state.selectedStayRef)) state.selectedStayRef = undefined;
    if (!proposalStillAuthorised(state.pendingAction, state) && replacePendingProposal(state, "search_changed")) {
      thread.activeSurfaces.delete(PENDING_ACTION_STAGE);
    }
    syncActiveTask(thread);
    return true;
  }

  /** ADR 0074: removes an open proposal from the committed thread and its surface. Used where no candidate state is committed. */
  #dropPendingProposal(threadId: string, reason: "task_switched"): void {
    const thread = this.getThread(threadId);
    if (!replacePendingProposal(thread.taskState, reason)) return;
    thread.activeSurfaces.delete(PENDING_ACTION_STAGE);
    syncActiveTask(thread);
  }

  /** With more than one domain registered, a cross-domain intent asks for confirmation rather than switching. */
  #route(text: string, activeDomain: string): AssistantTurnOutput | undefined {
    const lower = text.toLowerCase();
    const active = this.#packs.packFor(activeDomain) ?? this.#activePack;
    if (active.intentKeywords.some((keyword) => lower.includes(keyword))) return undefined;
    for (const id of this.#packs.ids()) {
      if (id === active.id) continue;
      const pack = this.#packs.packFor(id);
      if (pack?.intentKeywords.some((keyword) => lower.includes(keyword))) {
        const label = `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
        return { ok: true, messages: [`Start a ${label} search? Your ${active.id} search is saved.`], surfaces: [] };
      }
    }
    return undefined;
  }

  get environment(): LocalGuestEnvironment {
    return this.#environment;
  }

  reset(): void {
    this.#threads.clear();
  }

  getThread(threadId: string): AssistantThreadState {
    let thread = this.#threads.get(threadId);
    if (!thread) {
      const initialTask: AssistantTask = {
        taskId: "task-1",
        domain: this.#activePack.id,
        state: createInitialTaskState(),
        activeSurfaces: new Map(),
        supersededSurfaces: new Set(),
        lastSurfaces: [],
        badge: 0,
      };
      thread = {
        threadId,
        guestActorId: this.#environment.config.guestId,
        tenantId: this.#environment.config.tenantId,
        conversationHistory: [],
        tasks: [initialTask],
        activeTaskId: initialTask.taskId,
        taskState: initialTask.state,
        activeSurfaces: new Map(),
        supersededSurfaces: new Set(),
        lastSurfaces: [],
        discoveryArtifactId: null,
      };
      this.#threads.set(threadId, thread);
    }
    return thread;
  }

  hasThread(threadId: string): boolean {
    return this.#threads.has(threadId);
  }

  /** Restores only app-validated canonical Shortlet state; no model history or provider metadata is accepted. */
  restoreShortletState(threadId: string, input: AssistantShortletRestoreInput): boolean {
    const principal = this.#environment.guestPrincipal();
    if (!threadId || input.principalId !== principal.id || input.tenantId !== this.#environment.config.tenantId || principal.tenantId !== input.tenantId) return false;
    const thread = this.getThread(threadId);
    const task = thread.tasks.find((entry) => entry.domain === "shortlet") ?? thread.tasks[0];
    if (!task || task.domain !== "shortlet") return false;
    const state = cloneTaskState(input.taskState);
    task.state = state;
    thread.activeTaskId = task.taskId;
    thread.taskState = state;
    thread.canonicalUserFactHistory = input.canonicalUserFacts.filter((fact) => /^\d{4}-\d{2}-\d{2}$/.test(fact));
    thread.conversationHistory.length = 0;
    thread.activeSurfaces.clear();
    thread.supersededSurfaces.clear();
    thread.lastSurfaces = [];
    // ADR 0106: the restored artifact is the same one the shell holds, so a View action has one authoritative artifact.
    thread.discoveryArtifactId = input.discoveryArtifact?.id ?? null;
    thread.discoveryArtifact = input.discoveryArtifact;
    // Issue 03 follow-up (ADR 0106): re-key the open confirmation under the surface id the guest holds. A surface id that does
    // not name this action is not restored, so its button events fail closed as STALE_SURFACE.
    const action = state.pendingAction;
    if (action && input.pendingActionSurfaceId === `thread-${threadId}:pending-action:${action.id}`) {
      thread.activeSurfaces.set(PENDING_ACTION_STAGE, input.pendingActionSurfaceId);
    }
    syncActiveTask(thread);
    return true;
  }

  /**
   * ADR 0106: stay facts the guest chose through a structured control (the date and guest chips) are guest-authored.
   * - A confirmed check-in becomes the task's server-owned date and a guest-authored fact, so a planner turn may propose it.
   * - Nights are recorded only with a guest-authored check-in and a valid stay (ADR 0023, ADR 0055). The checkout is
   *   derived from them and checked by StayDateRange; an invalid stay records neither nights nor checkout.
   * - A party size is recorded as a positive integer. A model-proposed fact is never recorded through this path.
   */
  recordGuestStay(threadId: string, facts: { readonly checkIn?: string; readonly nights?: number; readonly partySize?: number }): boolean {
    const thread = this.#threads.get(threadId);
    if (!thread) return false;
    if (facts.checkIn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(facts.checkIn)) return false;
    const stay = thread.taskState.stayIntent;
    if (facts.checkIn !== undefined) {
      stay.checkIn = facts.checkIn;
      stay.isDemoDate = false;
      stay.checkOut = undefined;
      stay.nights = undefined;
      thread.canonicalUserFactHistory = [...(thread.canonicalUserFactHistory ?? []).filter((fact) => fact !== facts.checkIn), facts.checkIn];
    }
    if (facts.nights !== undefined && stay.isDemoDate === false && typeof stay.checkIn === "string") {
      const checkOut = validatedCheckOutForNights(stay.checkIn, facts.nights, this.#environment.clock(), this.#environment.extendedStayPolicy);
      if (checkOut !== null) {
        stay.nights = facts.nights;
        stay.checkOut = checkOut;
      }
    }
    if (facts.partySize !== undefined && Number.isSafeInteger(facts.partySize) && facts.partySize > 0) stay.partySize = facts.partySize;
    const task = thread.tasks.find((entry) => entry.taskId === thread.activeTaskId);
    if (task) task.state = thread.taskState;
    return true;
  }

  /**
   * ADR 0106 (review follow-up): the criteria strip's area. A general area (no neighbourhood) clears the neighbourhood. Only an
   * area in the strip's own catalogue (SEARCH_AREAS, through searchAreaFor) is recorded; any other city or neighbourhood is refused
   * and the stay is unchanged.
   */
  recordGuestArea(threadId: string, area: { readonly city: string; readonly neighbourhood?: string }): boolean {
    const thread = this.#threads.get(threadId);
    if (!thread) return false;
    if (searchAreaFor(area) === undefined) return false;
    const stay = thread.taskState.stayIntent;
    stay.location = area.city;
    if (area.neighbourhood === undefined) delete stay.neighbourhood;
    else stay.neighbourhood = area.neighbourhood;
    const task = thread.tasks.find((entry) => entry.taskId === thread.activeTaskId);
    if (task) task.state = thread.taskState;
    return true;
  }

  selectShortletUnit(threadId: string, unitId: string): boolean {
    const thread = this.#threads.get(threadId);
    if (!thread) return false;
    const selected = thread.taskState.shortlist.find((stay) => stay.unitId === unitId);
    if (!selected) return false;
    thread.taskState.selectedStayRef = selected.stayRef;
    const task = thread.tasks.find((entry) => entry.taskId === thread.activeTaskId);
    if (task) task.state = thread.taskState;
    return true;
  }

  clearShortletSelection(threadId: string): void {
    const thread = this.#threads.get(threadId);
    if (!thread) return;
    thread.taskState.selectedStayRef = undefined;
    const task = thread.tasks.find((entry) => entry.taskId === thread.activeTaskId);
    if (task) task.state = thread.taskState;
  }

  async handleTurn(threadId: string, text: string): Promise<AssistantTurnOutput> {
    const controlStartedAt = performance.now();
    const recordOutcome = (outcome: AssistantControlOutcome) => this.#recordControlOutcome(outcome, performance.now() - controlStartedAt);
    // Issue 02 / ADR 0079: the turn deadline runs from the start of the turn, scope stage included.
    // Each planner and summary call is clamped to the time left in the turn budget, so the budget is a real cap on the
    // turn. Below the minimum viable timeout (the lower runtime bound, MIN_ASSISTANT_RUNTIME_LIMIT_MS) no call starts and
    // the turn stops with `turn_deadline`.
    const turnStartedAt = this.#environment.clock().getTime();
    const nextCallTimeoutMs = (): number => {
      const remainingMs = turnStartedAt + this.#turnDeadlineMs - this.#environment.clock().getTime();
      if (remainingMs < MIN_ASSISTANT_RUNTIME_LIMIT_MS) throw new AssistantTurnDeadlineError();
      return Math.min(this.#modelCallTimeoutMs, remainingMs);
    };
    const thread = this.getThread(threadId);

    // 1. Transactional candidates (Item 24, ADR 0070): every change goes to `tx`; the thread changes only at a commit site.
    const tx = new TurnTransaction(thread);
    const candidateHistory = this.#sanitizeHistory(thread.conversationHistory);

    // The active task decides the active pack: its tools, prompt and projections.
    const candidateDomain = () => tx.tasks.find((task) => task.taskId === tx.activeTaskId)?.domain ?? this.#activePack.id;
    const candidatePack = () => this.#packs.packFor(candidateDomain()) ?? this.#activePack;
    let validatedDomainId: string | undefined;
    let validatedTurnIntents: readonly ConciergeIntent[] = [];
    let validatedTurnToolNames: ReadonlySet<string> = new Set();
    let taskSwitchPermitted = false;
    // ADR 0099/0106: intersect the active pack, its current-state tools, and this turn's validated intents.
    const taskTools = () => {
      const pack = candidatePack();
      const domainTools = pack.id === validatedDomainId
        ? toolsForValidatedIntents(pack, tx.taskState, validatedTurnIntents)
        : [];
      const taskTools = this.#packs.size > 1 && taskSwitchPermitted ? PLATFORM_TASK_TOOLS : [];
      return [...taskTools, ...domainTools];
    };

    // 2. Check for Pending Action Confirmation in Natural Language (Item 13, 15)
    // ADR 0074: a typed confirmation or cancellation attempt after a replaced proposal sends nothing. Only such an attempt
    // consumes the notice; an unrelated typed turn leaves it.
    if (!tx.taskState.pendingAction && tx.taskState.replacedPendingAction) {
      // The notice is consumed only by an explicit confirmation or cancellation attempt (assistant-state.ts). An unrelated turn
      // leaves it in place, so the next yes still gets the replaced reply.
      const attemptsConfirmation = isExplicitConfirmation(text) || isExplicitCancellation(text);
      if (attemptsConfirmation) {
        tx.taskState.replacedPendingAction = null;
        thread.conversationHistory.push({ role: "user", text: redactSensitiveData(text) as string });
        thread.conversationHistory.push({ role: "assistant", text: "Server reply delivered." });
        this.#commitHistory(thread, thread.conversationHistory, candidatePack(), tx.taskState);
        tx.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: tx.lastSurfaces });
        return { ok: true, messages: [ASSISTANT_CONTROL_COPY.proposalReplaced], surfaces: [], tasks: this.getTaskRail(threadId) };
      }
    }

    if (tx.taskState.pendingAction && !tx.taskState.pendingAction.executed) {
      if (isExplicitConfirmation(text)) {
        const execution = this.#executePendingAction(threadId, tx.taskState.pendingAction, tx);

        if (!execution.ok) {
          return { ok: false, code: execution.code, message: execution.message };
        }

        // Action completed: commit state transaction
        thread.conversationHistory.push({ role: "user", text: redactSensitiveData(text) as string });
        thread.conversationHistory.push({ role: "assistant", text: "Server reply delivered." });
        this.#commitHistory(thread, thread.conversationHistory, candidatePack(), tx.taskState);
        tx.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: execution.surfaces.length > 0 ? execution.surfaces : tx.lastSurfaces });

        return {
          ok: true,
          messages: [execution.message],
          surfaces: execution.surfaces,
          tasks: this.getTaskRail(threadId),
        };
      }

      if (isExplicitCancellation(text)) {
        const action = tx.taskState.pendingAction;
        tx.taskState.pendingAction = null;
        tx.supersede(PENDING_ACTION_STAGE);

        // Commit cancellation
        thread.conversationHistory.push({ role: "user", text: redactSensitiveData(text) as string });
        thread.conversationHistory.push({ role: "assistant", text: "Server reply delivered." });
        this.#commitHistory(thread, thread.conversationHistory, candidatePack(), tx.taskState);
        tx.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: tx.lastSurfaces });

        return {
          ok: true,
          messages: ["Action cancelled. Let me know how else I can help."],
          surfaces: [],
          tasks: this.getTaskRail(threadId),
        };
      }
    }

    // 2b. Router: with more than one domain registered, a cross-domain intent asks for confirmation
    // before any switch (never a silent task switch).
    if (this.#packs.size > 1) {
      const routed = this.#route(text, candidateDomain());
      if (routed) {
        // ADR 0074: a cross-domain switch after a proposal removes the proposal's authority.
        this.#dropPendingProposal(threadId, "task_switched");
        return routed;
      }
    }

    // 3. User message turn
    const originalUserText = text;
    const packForScope = candidatePack();
    const safeUserText = redactSensitiveData(text) as string;
    let scopeFailureOutcome: "quota_refusal" | "guard_failure" | undefined;
    const assessment = text.length > this.#maxInputCharacters ? undefined : await assessScopeSafely(this.#scopeClassifier, safeUserText, {
      domain: packForScope.id, description: packForScope.scopeDescription ?? packForScope.label,
      hasShortlist: tx.taskState.shortlist.length > 0, hasSelectedStay: Boolean(tx.taskState.selectedStayRef), hasOffer: Boolean(tx.taskState.currentOfferId),
    }, this.#scopeOuterTimeoutMs, (error) => {
      // A retry failure carries the stage's decisive error; the first failure's outcome stands for refused or skipped retries (ADR 0106 amendment).
      const cause = error instanceof ScopeClassifierRetryError ? error.failure : error;
      this.#diagnose({ ...createFailureDiagnostic("provider_request", 0, undefined, cause),
        ...(cause instanceof ScopeClassificationError ? { scopeFailureReason: cause.reason, ...(cause.finishReason ? { finishReason: cause.finishReason } : {}) } : {}),
        ...(error instanceof ScopeClassifierRetryError ? { classifierAttempts: error.classifierAttempts, firstAttemptScopeFailureReason: error.firstAttemptScopeFailureReason, classifierRetryResult: error.classifierRetryResult,
          ...(error.firstAttemptFinishReason ? { firstAttemptFinishReason: error.firstAttemptFinishReason } : {}) } : {}) });
      scopeFailureOutcome = cause instanceof ModelRequestGuardError && cause.code === "quota_denied" ? "quota_refusal" : "guard_failure";
    });
    if (!assessment || assessment.scope === "unclear" || assessment.scope === "out_of_scope" || assessment.risk === "policy_override" || assessment.risk === "unauthorized_data" || assessment.risk === "unknown") {
      const scopeOutcome = assessment?.scope === "out_of_scope" ? "scope_redirect" : "scope_unavailable";
      const controlOutcome = scopeFailureOutcome ?? scopeOutcome;
      // One count per turn: the outcome this turn returns (ADR 0106 telemetry, closed codes only).
      recordOutcome(controlOutcome);
      return { ok: true, messages: [controlOutcome === "scope_redirect" ? ASSISTANT_CONTROL_COPY.redirect : ASSISTANT_CONTROL_COPY.unavailable],
        surfaces: [], modelHandled: false, discardUserInput: true, controlOutcome, tasks: this.getTaskRail(threadId) };
    }
    const discardUserInput = assessment.scope === "mixed";
    const validMixedLocation = assessment.slots.neighbourhood === null || packForScope.scopeLocations?.includes(assessment.slots.neighbourhood) === true;
    if (discardUserInput && (!validMixedLocation || [assessment.slots.checkIn, assessment.slots.checkOut].some((date) => date !== null && !containsGuestDate(originalUserText, date, this.#environment.clock())))) {
      recordOutcome("scope_unavailable");
      return { ok: true, messages: [ASSISTANT_CONTROL_COPY.unavailable], surfaces: [], modelHandled: false,
        discardUserInput: true, controlOutcome: "scope_unavailable", tasks: this.getTaskRail(threadId) };
    }
    if (discardUserInput) text = scopedMixedInput(assessment);
    validatedDomainId = packForScope.id;
    validatedTurnIntents = assessment.intents;
    validatedTurnToolNames = toolNamesForValidatedIntents(packForScope, assessment.intents);
    taskSwitchPermitted = assessment.intents.includes("task_switch");
    candidateHistory.push({ role: "user", text: redactSensitiveData(discardUserInput ? text : originalUserText) as string });

    const userTextHistory: string[] = [...(thread.canonicalUserFactHistory ?? []), ...candidateHistory
      .filter((s): s is Extract<AssistantConversationStep, { role: "user" }> => s.role === "user")
      .map((s) => s.text)];
    // ADR 0106: provenance stays server-side; unsupported text never enters model history.
    if (discardUserInput) userTextHistory[userTextHistory.length - 1] = redactSensitiveData(text) as string;

    let round = 0;
    let finalAssistantReply: string | undefined;
    let activeStage: AssistantDiagnosticStage = "provider_request";
    let activeToolName: string | undefined;
    let hasSuccessfulApplicationOperation = false;
    // The renderer uses the latest round; reference validation accepts every successful result of this turn (ADR 0106).
    let latestRawResults: AssistantToolResult[] = [];
    let turnRawResults: AssistantToolResult[] = [];
    let controlOutcome: AssistantControlOutcome = "successful_model_handling";
    let stopReason: AssistantStopReason | undefined;
    // Exactly one `turn_stop` per planner turn: emitted from one place, after the stop reason is final, never twice.
    let stopEmitted = false;
    const emitStop = (): void => {
      if (stopEmitted || stopReason === undefined) return;
      stopEmitted = true;
      this.#diagnose({
        stage: "turn_stop",
        round,
        succeeded: stopReason === "reply" || stopReason === "round_limit" || stopReason === "tool_denial",
        stopReason,
      });
    };

    try {
      while (round < MAX_ASSISTANT_TOOL_ROUNDS) {
        // Checked before the round counter moves, so a deadline before the first planner call reports round 0.
        const plannerTimeoutMs = nextCallTimeoutMs();
        round++;

        const isFunctionResultContinuation = round > 1 && candidateHistory.at(-1)?.role === "tool_results";
        activeStage = isFunctionResultContinuation ? "function_result_round_trip" : "provider_request";
        const modelResponse = await this.#modelClient.generate({
          systemInstruction: composeSystemInstruction(candidatePack()),
          tools: taskTools(),
          history: this.#boundedHistory(candidateHistory, candidatePack(), tx.taskState),
          timeoutMs: plannerTimeoutMs,
          structuredOutput: { name: "assistant_reply_plan", schema: replyPlanSchema(successfulToolNames(turnRawResults)), strict: true },
          maxOutputTokens: this.#maxPlanningOutputTokens,
        });
        this.#diagnose({ stage: "provider_request", round, succeeded: true });
        if (isFunctionResultContinuation) {
          this.#diagnose({ stage: "function_result_round_trip", round, succeeded: true });
        }
        activeStage = "provider_response";
        this.#diagnose({ stage: activeStage, round, succeeded: true });

        // If model produced no tool calls, it is returning a natural language reply
        if (!modelResponse.toolCalls || modelResponse.toolCalls.length === 0) {
          // ADR 0106: accept a validated typed plan; discard legacy prose and opaque steps.
          const latestResults = latestRawResults;
          const parsedPlan = parseReplyPlan(modelResponse, turnRawResults);
          const plan = typeof parsedPlan === "string" ? undefined : parsedPlan;
          if (typeof parsedPlan === "string") {
            this.#diagnose({ stage: "provider_response", round, succeeded: false, failureClass: "MODEL_SELECTION_FAILURE", replyPlanRejectionReason: parsedPlan });
          }
          if (!plan) {
            controlOutcome = "rejected_plan_fallback";
          } else if (plan.kind === "support_guidance") {
            controlOutcome = "support_guidance";
          }
          controlOutcome = candidatePack().replyControlOutcome?.(latestResults) ?? controlOutcome;
          finalAssistantReply = candidatePack().renderReply?.(plan, latestResults, userTextHistory.at(-1) ?? "")
            ?? "I can help with your current request. Please review the information shown and tell me what you need next.";
          candidateHistory.push({ role: "assistant", text: "Server reply delivered." });
          stopReason = "reply";
          break;
        }

        const toolResults: AssistantToolResult[] = [];
        const acceptedCalls: AssistantToolCall[] = [];
        const roundRawResults: AssistantToolResult[] = [];

        for (const call of modelResponse.toolCalls) {
          activeStage = "tool_execution";
          activeToolName = safeAssistantToolName(call.name, this.#packs);
          const offeredTool = taskTools().find((tool) => tool.name === call.name);
          const activePack = candidatePack();
          const isTaskTool = this.#isPlatformTaskTool(call.name);
          const turnAuthorized = isTaskTool
            ? taskSwitchPermitted && this.#packs.size > 1
            : activePack.id === validatedDomainId && validatedTurnToolNames.has(call.name);
          const schemaTool = offeredTool ?? (activePack.id === validatedDomainId ? activePack.toolDefinition?.(call.name) : undefined);
          // ADR 0072/0075/0106: check model arguments against the offered schema before the task-tool path,
          // pack preconditions or command routing. The message names the field and never the value.
          const argumentViolation = turnAuthorized && schemaTool
            ? findToolArgumentViolation(schemaTool.parametersSchema, call.args)
            : undefined;
          const malformedArguments = argumentViolation
            ? { code: "invalid_arguments" as const, message: toolArgumentFailureMessage(argumentViolation) }
            : undefined;
          const precondition = !turnAuthorized || isTaskTool || malformedArguments || !offeredTool
            ? undefined
            : activePack.validateToolCall(call.name, call.args, tx.taskState);
          const stateUnavailable = !isTaskTool && !offeredTool && turnAuthorized && !malformedArguments
            ? activePack.validateToolCall(call.name, call.args, tx.taskState)
              ?? { code: "invalid_tool_for_state" as const, message: "That operation is not available for the current Guest workflow." }
            : undefined;
          const invalidCall = !turnAuthorized || !schemaTool
            ? { code: "invalid_tool_for_state" as const, message: "That operation is not available for the current Guest workflow." }
            : malformedArguments ?? precondition ?? stateUnavailable;
          if (invalidCall) {
            controlOutcome = "tool_denial";
            this.#diagnose({
              stage: "tool_execution",
              round,
              toolName: safeAssistantToolName(call.name, this.#packs),
              succeeded: false,
              failureClass: invalidCall.code === "invalid_tool_for_state" ? "INVALID_TOOL_FOR_STATE" : "MODEL_SELECTION_FAILURE",
            });
            toolResults.push({
              callId: call.id,
              name: safeAssistantToolName(call.name, this.#packs),
              result: { error: invalidCall.code, message: invalidCall.message },
              isError: true,
            });
            continue;
          }
          acceptedCalls.push(call);
          if (this.#isPlatformTaskTool(call.name)) {
            const previousActiveTaskId = tx.activeTaskId;
            const previousTaskState = tx.taskState;
            const applied = this.#applyTaskTool(
              call.name,
              call.args,
              tx.tasks,
              tx.activeTaskId,
              tx.taskState,
              { activeSurfaces: tx.activeSurfaces, supersededSurfaces: tx.supersededSurfaces, lastSurfaces: tx.lastSurfaces },
            );
            // ADR 0074: a switch that changes the active task removes the proposal of the task the guest left. A refused switch (unknown
            // task or domain) returns the same active task, so this guard alone keeps the proposal. The `error` field needs no separate
            // check: applyTaskTool never changes the active task on an error.
            if (applied.activeTaskId !== previousActiveTaskId) replacePendingProposal(previousTaskState, "task_switched");
            tx.taskState = applied.state;
            tx.activeTaskId = applied.activeTaskId;
            tx.activeSurfaces = applied.workspace.activeSurfaces;
            tx.supersededSurfaces = applied.workspace.supersededSurfaces;
            tx.lastSurfaces = applied.workspace.lastSurfaces;
            const safeTaskResult = typeof applied.result.started === "string"
              ? { started: applied.result.started }
              : typeof applied.result.switched === "string"
                ? { switched: true, domain: applied.result.domain }
                : { error: "TASK_UNAVAILABLE" };
            toolResults.push({ callId: call.id, name: call.name, result: safeTaskResult });
            continue;
          }
          const toolContext: AssistantToolContext = {
            environment: this.#environment,
            taskState: tx.taskState,
            threadId,
            taskId: tx.activeTaskId,
            userTextHistory,
            // ADR 0106: classifier date slots bind to roles only through server-side checks; ambiguous ones carry no check-in authority.
            currentTurnDates: currentTurnDateRoles(originalUserText, assessment.slots, this.#environment.clock()),
            now: this.#environment.clock(),
            demoCheckIn: this.#environment.config.demoCheckIn,
          };

          activeStage = "application_operation";
          const execution = candidatePack().executeTool(call.name, call.args, toolContext);
          hasSuccessfulApplicationOperation = true;
          const resultCount = getSafeResultCount(execution.result);
          this.#diagnose({
            stage: activeStage,
            round,
            toolName: safeAssistantToolName(call.name, this.#packs),
            succeeded: true,
            ...(resultCount !== undefined ? { resultCount } : {}),
            ...(execution.effectCode ? { effectCode: execution.effectCode } : {}),
          });
          roundRawResults.push({ callId: call.id, name: call.name, result: execution.result });
          toolResults.push({
            callId: call.id,
            name: call.name,
            result: candidatePack().projectToolResult?.(call.name, execution.result, { maxItems: this.#maxContextItems }) ?? {},
          });

          // Application projections are generated server-side from authoritative operation results.
          // The pack's stage handlers claim an execution first (issue 04). The platform files a pending confirmation and a
          // projected surface itself, after them, under the owning pack's id (ADR 0099).
          activeStage = "projection";
          const claim = projectWithHandlers(candidatePack().stageHandlers ?? [], { toolName: call.name, args: call.args, execution }, {
            threadId,
            tx,
            pack: candidatePack(),
            environment: this.#environment,
            setStage: (stage) => { activeStage = stage; },
          });
          if (claim) {
            if (claim.surface) tx.addSurface(claim.surface, claim.fallbackMessage);
          } else if (execution.pendingActionCreated) {
            // Consequential action proposed -> create confirmation card surface
            const action = execution.pendingActionCreated;
            tx.taskState.replacedPendingAction = null;
            const surfaceId = `thread-${threadId}:pending-action:${action.id}`;
            tx.supersede(PENDING_ACTION_STAGE);
            tx.place(PENDING_ACTION_STAGE, surfaceId);

            activeStage = "a2ui";
            const a2uiMessages = candidatePack().pendingActionSurface(action, surfaceId);
            tx.addSurface({ surfaceId, a2uiMessages });
          } else if (execution.projectedSurface) {
            const surface = execution.projectedSurface;
            const stage = `${candidatePack().id}:${surface.kind}`;
            tx.supersede(stage);
            tx.place(stage, surface.surfaceId);
            activeStage = "a2ui";
            tx.addSurface({ surfaceId: surface.surfaceId, a2uiMessages: surface.a2uiMessages });
          }
        }

        latestRawResults = roundRawResults;
        turnRawResults = [...turnRawResults, ...roundRawResults];

        if (acceptedCalls.length === 0 && candidateHistory.at(-1)?.role === "user") candidateHistory.pop();
        candidateHistory.push({
          role: "tool_calls",
          calls: (acceptedCalls.length > 0 ? acceptedCalls : modelResponse.toolCalls).map((call) => ({ id: call.id, name: safeAssistantToolName(call.name, this.#packs), args: acceptedCalls.some((accepted) => accepted.id === call.id) ? call.args : {} })),
          ...(modelResponse.rawStep !== undefined && this.#modelClient.projectProviderContinuation
            ? { rawStep: this.#modelClient.projectProviderContinuation(modelResponse, acceptedCalls) } : {}),
        });
        candidateHistory.push({
          role: "tool_results",
          results: acceptedCalls.length > 0 ? toolResults.filter((result) => acceptedCalls.some((call) => call.id === result.callId)) : toolResults,
        });
        activeStage = "function_result_round_trip";
        activeToolName = undefined;
      }

      if (!finalAssistantReply) {
        // Run one final step to get summary reply if bounded rounds reached.
        // ADR 0106 amendment / issue 02: the one tool-free summary call takes the same timeout and deadline as a planner round.
        stopReason = "round_limit";
        const summaryTimeoutMs = nextCallTimeoutMs();
        round++;
        activeStage = "function_result_round_trip";
        const finalModelResponse = await this.#modelClient.generate({
          systemInstruction: composeSystemInstruction(candidatePack()),
          tools: [],
          history: this.#boundedHistory(candidateHistory, candidatePack(), tx.taskState),
          timeoutMs: summaryTimeoutMs,
          structuredOutput: { name: "assistant_reply_plan", schema: replyPlanSchema(successfulToolNames(turnRawResults)), strict: true },
          maxOutputTokens: this.#maxReplyOutputTokens,
        });
        this.#diagnose({ stage: "provider_request", round, succeeded: true });
        this.#diagnose({ stage: "function_result_round_trip", round, succeeded: true });
        activeStage = "provider_response";
        this.#diagnose({ stage: activeStage, round, succeeded: true });
        const lastStep = candidateHistory.at(-1);
        const latestResults = latestRawResults;
        const parsedFinalPlan = parseReplyPlan(finalModelResponse, turnRawResults);
        if (typeof parsedFinalPlan === "string") {
          this.#diagnose({ stage: "provider_response", round, succeeded: false, failureClass: "MODEL_SELECTION_FAILURE", replyPlanRejectionReason: parsedFinalPlan });
        }
        const plan = typeof parsedFinalPlan === "string" ? undefined : parsedFinalPlan;
        finalAssistantReply = candidatePack().renderReply?.(plan, latestResults, userTextHistory.at(-1) ?? "")
          ?? "I can help with your current request. Please review the information shown and tell me what you need next.";
        candidateHistory.push({ role: "assistant", text: "Server reply delivered." });
      }

      // 4. Commit Transaction (Item 24)
      this.#commitHistory(thread, candidateHistory, candidatePack(), tx.taskState);
      tx.commit(thread, { state: true, tasks: true, discovery: true, lastSurfaces: tx.surfaces.length > 0 ? tx.surfaces : tx.lastSurfaces });
      recordOutcome(controlOutcome);
      // Set by the reply branch (`reply`) or the summary call after the round cap (`round_limit`), never both.
      const output: AssistantTurnOutput = {
        ok: true,
        messages: [finalAssistantReply],
        surfaces: tx.surfaces,
        tasks: this.getTaskRail(threadId),
        modelHandled: true,
        discardUserInput,
        controlOutcome,
        stopReason,
      };
      // Emitted after the output is built, so nothing that could throw sits between the stop event and the return.
      emitStop();
      return output;
    } catch (error) {
      // Issue 02: the turn deadline and a rejected planner date/stay detail are stops of their own; every other failure is `error`.
      const turnDeadline = error instanceof AssistantTurnDeadlineError;
      const toolDenial = error instanceof AssistantDateProvenanceError || error instanceof AssistantDateValidationError || error instanceof AssistantStayDetailsError;
      stopReason = turnDeadline ? "turn_deadline" : toolDenial ? "tool_denial" : "error";
      if (error instanceof ModelRequestGuardError && (error.code === "quota_denied" || error.code === "quota_unavailable")) {
        controlOutcome = error.code === "quota_denied" ? "quota_refusal" : "guard_failure";
      } else if (error instanceof ModelRequestGuardError && error.code === "deadline_exceeded") {
        controlOutcome = "guard_failure";
      } else if (turnDeadline) {
        // The turn deadline is a server-owned limit, counted like the guard's deadline.
        controlOutcome = "guard_failure";
      } else {
        controlOutcome = "model_handling_failure";
      }
      if (!turnDeadline) this.#diagnose(createFailureDiagnostic(activeStage, round, activeToolName, error));
      emitStop();
      if (hasSuccessfulApplicationOperation && tx.surfaces.length > 0) {
        // The fallback replaces the failure outcome, so this turn is counted once as the fallback.
        controlOutcome = "rejected_plan_fallback";
        recordOutcome(controlOutcome);
        const message = tx.fallbackMessage;
        candidateHistory.push({ role: "assistant", text: "Server reply delivered." });
        this.#commitHistory(thread, candidateHistory, candidatePack(), tx.taskState);
        tx.commit(thread, { state: true, tasks: true, discovery: true, lastSurfaces: tx.surfaces });
        return { ok: true, messages: [message], surfaces: tx.surfaces, tasks: this.getTaskRail(threadId), modelHandled: true, discardUserInput, controlOutcome: "rejected_plan_fallback", stopReason };
      }
      if (toolDenial) {
        // ADR 0106: a planner date the guest did not author, one that fails the stay rules, or a search missing its stay
        // details is a rejected tool call. The turn keeps the guest's message, commits no new task state, and asks the guest.
        controlOutcome = "tool_denial";
        recordOutcome(controlOutcome);
        candidateHistory.push({ role: "assistant", text: "Server reply delivered." });
        this.#commitHistory(thread, candidateHistory, candidatePack(), thread.taskState);
        const clarification = error instanceof AssistantStayDetailsError
          ? candidatePack().stayDetailsClarification
          : candidatePack().dateClarification;
        return { ok: true, messages: [clarification ?? ASSISTANT_CONTROL_COPY.unavailable], surfaces: [], modelHandled: false,
          discardUserInput: false, controlOutcome, tasks: this.getTaskRail(threadId), stopReason };
      }
      recordOutcome(controlOutcome);
      // Rollback: thread is not mutated on error
      if (discardUserInput) {
        return { ok: true, messages: [ASSISTANT_CONTROL_COPY.unavailable], surfaces: [],
          modelHandled: false, discardUserInput: true, controlOutcome, tasks: this.getTaskRail(threadId), stopReason };
      }
      if (error instanceof ModelRequestGuardError) {
        return {
          ok: true,
          messages: [ASSISTANT_CONTROL_COPY.unavailable],
          surfaces: [],
          modelHandled: false,
          discardUserInput: true,
          controlOutcome,
          tasks: this.getTaskRail(threadId),
          stopReason,
        };
      }
      return {
        ok: false,
        code: "CONCIERGE_UNAVAILABLE",
        message: "The concierge is temporarily unavailable. Please try again.",
        stopReason,
        ...((activeStage === "provider_request" || activeStage === "function_result_round_trip") && isProviderUnavailable(error)
          ? { providerUnavailable: true } : {}),
      };
    }
  }

  #diagnose(event: AssistantDiagnosticEvent): void {
    try {
      this.#onDiagnostic?.(event);
    } catch {
      // Diagnostics are observational and must never affect the authoritative flow.
    }
  }

  /** ADR 0106 amendment: closed retry metadata only. A recovered retry adds a succeeded stage diagnostic and no scope failure. */
  #recordClassifierRetry(event: ScopeClassifierRetryEvent): void {
    try {
      this.#environment.telemetry.track({ type: "assistant.classifier.retry.v1", recovered: event.recovered, classifierAttempts: event.classifierAttempts,
        firstAttemptScopeFailureReason: event.firstAttemptScopeFailureReason, classifierRetryResult: event.classifierRetryResult });
    } catch {
      // Telemetry must never affect the authoritative workflow.
    }
    if (event.recovered) {
      this.#diagnose({ stage: "provider_request", round: 0, succeeded: true, classifierAttempts: 2,
        firstAttemptScopeFailureReason: event.firstAttemptScopeFailureReason, classifierRetryResult: "recovered",
        ...(event.firstAttemptFinishReason ? { firstAttemptFinishReason: event.firstAttemptFinishReason } : {}) });
    }
  }

  #recordControlOutcome(outcome: AssistantControlOutcome, elapsedMs: number): void {
    try {
      // ADR 0075: store closed outcome codes only. Never include prompt, reply, identity, or provider error text.
      this.#environment.telemetry.track({ type: "assistant.control.outcome.v1", outcome, elapsedMs: Math.round(Math.max(0, elapsedMs)) });
    } catch {
      // Telemetry must never affect the authoritative workflow.
    }
  }

  handleAssistantEvent(threadId: string, eventName: string, context: AssistantEventContext | null | undefined): AssistantTurnOutput {
    const thread = this.getThread(threadId);
    const tx = new TurnTransaction(thread);

    if (eventName === TASK_START_EVENT || eventName === TASK_SWITCH_EVENT) {
      const previousTaskState = tx.taskState;
      const applied = this.#applyTaskTool(
        eventName === TASK_SWITCH_EVENT ? "switch_task" : "start_task",
        { domain: context?.domain, taskId: context?.taskId },
        tx.tasks,
        thread.activeTaskId,
        tx.taskState,
        { activeSurfaces: tx.activeSurfaces, supersededSurfaces: tx.supersededSurfaces, lastSurfaces: tx.lastSurfaces },
      );
      const error = applied.result.error;
      if (typeof error === "string") {
        return { ok: false, code: error, message: String(applied.result.message ?? "That task could not be opened.") };
      }
      // ADR 0074: the proposal of the task the guest left is removed. No guard is needed: a refused switch returns before this line,
      // and a same-task switch rewrites that task's stored state from the committed state (#syncActiveTask below), so the removal
      // is then overwritten. Removing a guard here changes no behaviour (issue 03 Comments).
      replacePendingProposal(previousTaskState, "task_switched");
      tx.taskState = applied.state;
      tx.activeSurfaces = applied.workspace.activeSurfaces;
      tx.supersededSurfaces = applied.workspace.supersededSurfaces;
      tx.lastSurfaces = applied.workspace.lastSurfaces;

      tx.activeTaskId = applied.activeTaskId;
      tx.commit(thread, { state: true, tasks: true, discovery: false, lastSurfaces: tx.lastSurfaces });

      const activeDomain = tx.tasks.find((task) => task.taskId === applied.activeTaskId)?.domain;
      const activeLabel = (activeDomain ? this.#packs.packFor(activeDomain) : undefined)?.label ?? "new";
      const message = eventName === TASK_SWITCH_EVENT
        ? `Switched to your ${activeLabel} task.`
        : `Started a ${activeLabel} task.`;

      return {
        ok: true,
        messages: [message],
        surfaces: tx.lastSurfaces,
        tasks: this.getTaskRail(threadId),
      };
    }

    const actionTask = tx.tasks.find((task) => task.taskId === thread.activeTaskId);
    const actionPack = actionTask ? this.#packs.packFor(actionTask.domain) : undefined;
    if (actionPack?.platformActionNames?.includes(eventName)) {
      const activeTask = actionTask;
      const pack = actionPack;
      // Platform action surfaces are filed under the owning pack's id (the generic projected-surface path).
      const checkoutStage = `${pack.id}:checkout`;
      const activeSurfaceId = tx.activeSurfaces.get(checkoutStage);
      if (!activeTask || !pack?.handlePlatformAction || !activeSurfaceId || context?.surfaceId !== activeSurfaceId || context.taskId !== activeTask.taskId) {
        return { ok: false, code: "STALE_SURFACE", message: "That checkout confirmation is no longer active." };
      }
      const result = pack.handlePlatformAction({
        actionName: eventName,
        context: { proposalId: context.proposalId, taskId: activeTask.taskId, expectedVersion: context.expectedVersion, cartVersion: context.cartVersion, confirmedTotalKobo: context.confirmedTotalKobo, surfaceId: activeSurfaceId },
        principal: this.#environment.guestPrincipal(),
        taskId: activeTask.taskId,
        activeSurfaceId,
      });
      if (!result.ok) return { ok: false, code: result.code, message: result.message };
      tx.supersede(checkoutStage);
      const resultSurfaces = result.surface ? [result.surface] : [];
      if (result.surface) {
        tx.place(checkoutStage, result.surface.surfaceId);
        tx.surfaces.push(result.surface);
      }
      tx.commit(thread, { state: false, tasks: false, discovery: false, lastSurfaces: resultSurfaces.length > 0 ? resultSurfaces : tx.lastSurfaces });
      return { ok: true, messages: [result.message], surfaces: resultSurfaces, tasks: this.getTaskRail(threadId) };
    }

    if (eventName === ASSISTANT_CONFIRM_ACTION_EVENT || eventName === ASSISTANT_CANCEL_ACTION_EVENT) {
      // ADR-0074: only the current authoritative surface retains action authority.
      const activeSurfaceId = tx.activeSurfaces.get(PENDING_ACTION_STAGE);
      if (!activeSurfaceId || context?.surfaceId !== activeSurfaceId) {
        return { ok: false, code: "STALE_SURFACE", message: "That action is no longer active." };
      }
    }

    if (eventName === ASSISTANT_CANCEL_ACTION_EVENT) {
      if (!tx.taskState.pendingAction || tx.taskState.pendingAction.id !== context?.actionId) {
        return { ok: false, code: "STALE_SURFACE", message: "That action is no longer active." };
      }
      tx.clearPendingAction();
      tx.supersede(PENDING_ACTION_STAGE);
      tx.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: tx.lastSurfaces });

      return {
        ok: true,
        messages: ["Action cancelled."],
        surfaces: [],
        tasks: this.getTaskRail(threadId),
      };
    }

    if (eventName === ASSISTANT_CONFIRM_ACTION_EVENT) {
      const action = tx.taskState.pendingAction;
      if (!action || action.id !== context?.actionId || action.executed) {
        return { ok: false, code: "STALE_SURFACE", message: "That action is no longer active." };
      }

      const execution = this.#executePendingAction(threadId, action, tx);

      if (!execution.ok) {
        return { ok: false, code: execution.code, message: execution.message };
      }

      tx.commit(thread, { state: true, tasks: false, discovery: false, lastSurfaces: execution.surfaces.length > 0 ? execution.surfaces : tx.lastSurfaces });

      return {
        ok: true,
        messages: [execution.message],
        surfaces: execution.surfaces,
        tasks: this.getTaskRail(threadId),
      };
    }

    return { ok: false, code: "UNSUPPORTED_EVENT", message: "Unknown assistant action." };
  }

  /** The shell task rail: each task's domain, label, status, active flag and badge, in task order. */
  getTaskRail(threadId: string): readonly AssistantTaskRailEntry[] {
    const thread = this.#threads.get(threadId);
    if (!thread) return [];
    return thread.tasks.map((task) => {
      const pack = this.#packs.packFor(task.domain);
      const summary = pack?.taskSummary(task.state);
      return {
        taskId: task.taskId,
        domain: task.domain,
        domainLabel: pack?.label ?? task.domain,
        status: summary?.status ?? "",
        ...(summary?.tone === undefined ? {} : { tone: summary.tone }),
        active: task.taskId === thread.activeTaskId,
        ...(task.badge > 0 ? { badge: task.badge } : {}),
      };
    });
  }

  /** Registered verticals for starter cards (only meaningful with more than one domain). */
  registeredVerticals(): readonly AssistantVertical[] {
    return this.#packs.ids().map((id) => {
      const pack = this.#packs.packFor(id);
      return {
        domain: id,
        label: pack?.label ?? id,
        ...(pack?.starterDescription === undefined ? {} : { description: pack.starterDescription }),
      };
    });
  }

  /** Records an async event against a background task: it gets a badge and the open workspace is untouched. */
  recordTaskEvent(threadId: string, taskId: string): { ok: boolean; code?: string; message?: string } {
    const thread = this.#threads.get(threadId);
    if (!thread) return { ok: false, code: "UNKNOWN_THREAD", message: "Unknown conversation." };
    if (taskId === thread.activeTaskId) {
      return { ok: false, code: "ACTIVE_TASK", message: "The open task is not a background task." };
    }
    const task = thread.tasks.find((candidate) => candidate.taskId === taskId);
    if (!task) return { ok: false, code: "UNKNOWN_TASK", message: "That task is not in this conversation." };
    task.badge += 1;
    return { ok: true };
  }

  #executePendingAction(
    threadId: string,
    action: PendingAssistantAction,
    tx: TurnTransaction,
  ): PendingActionOutcome {
    if (action.executed) {
      return { ok: false, code: "STALE_SURFACE", message: "This action was already executed." };
    }
    // ADR-0070/ADR-0074/ADR-0075: interaction authority is scoped and expires fail closed.
    const thread = this.#threads.get(threadId);
    const expiresAt = Date.parse(action.expiresAt);
    if (action.threadId !== threadId
      || !thread
      || action.guestActorId !== thread.guestActorId
      || action.tenantId !== thread.tenantId
      || !Number.isFinite(expiresAt)
      || expiresAt <= this.#environment.clock().getTime()) {
      return { ok: false, code: "STALE_SURFACE", message: "This action has expired or is no longer authorized." };
    }

    tx.supersede(PENDING_ACTION_STAGE);

    // Issue 04: the pack's confirm handler for this kind runs only after the checks above (ADR 0070, 0074, 0075).
    const pack = this.#packForThread(threadId);
    const handler = pack.stageHandlers?.find((candidate) => candidate.confirms === action.type);
    if (!handler?.confirm) {
      return { ok: false, code: "UNSUPPORTED_ACTION", message: "Unsupported action." };
    }
    return handler.confirm(action, { threadId, tx, pack, environment: this.#environment, setStage: () => undefined });
  }
}

function getSafeResultCount(result: unknown): number | undefined {
  if (typeof result !== "object" || result === null || !("resultCount" in result)) return undefined;
  const count = result.resultCount;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function safeAssistantToolName(name: string, packs?: AssistantPackRegistry): string {
  return PLATFORM_TASK_TOOL_NAMES.includes(name) || packs?.ids().some((id) => packs.packFor(id)?.toolNames.includes(name)) === true ? name : "unknown_tool";
}

function createFailureDiagnostic(
  stage: AssistantDiagnosticStage,
  round: number,
  toolName: string | undefined,
  error: unknown,
): AssistantDiagnosticEvent {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : undefined;
  const statusCandidate = record?.status ?? record?.statusCode;
  const codeCandidate = record?.code;
  const safeStatus = typeof statusCandidate === "number"
    && Number.isSafeInteger(statusCandidate)
    && statusCandidate >= 100
    && statusCandidate <= 599
    ? statusCandidate
    : undefined;
  const safeCode = typeof codeCandidate === "string" && new Set(["RATE_LIMITED"]).has(codeCandidate)
    ? codeCandidate
    : undefined;
  return {
    stage,
    round,
    succeeded: false,
    ...(toolName ? { toolName } : {}),
    errorClass: error instanceof Error && ["Error", "TypeError", "RangeError", "SyntaxError", "APIError", "APIConnectionError", "RateLimitError", "AssistantDateProvenanceError", "AssistantDateValidationError", "ModelRequestGuardError"].includes(error.constructor.name) ? error.constructor.name : "UNKNOWN_ERROR",
    failureClass: classifyFailure(stage, error),
    ...(safeStatus !== undefined ? { providerStatusCode: safeStatus } : {}),
    ...(safeCode !== undefined ? { providerErrorCode: safeCode } : {}),
  };
}

function classifyFailure(stage: AssistantDiagnosticStage, error: unknown): AssistantFailureClass {
  // ADR 0106: a local quota refusal stopped the call before transport; it is neither a model selection nor a provider fault.
  if (error instanceof ModelRequestGuardError && error.code === "quota_denied") return "QUOTA_REFUSED";
  const errorClass = error instanceof Error ? error.constructor.name : "";
  const providerStatus = typeof error === "object" && error !== null && "status" in error
    && typeof error.status === "number";
  if ((stage === "provider_request" || stage === "function_result_round_trip")
    && (errorClass === "APIConnectionError" || errorClass === "RateLimitError" || errorClass === "APIError" || providerStatus)) {
    return "PROVIDER_TRANSPORT_FAILURE";
  }
  switch (stage) {
    case "provider_response":
      return "MODEL_SELECTION_FAILURE";
    case "application_operation":
      return "APPLICATION_OPERATION_FAILURE";
    case "projection":
      return "PROJECTION_FAILURE";
    case "a2ui":
      return "A2UI_FAILURE";
    case "weaver":
      return "WEAVER_FAILURE";
    default:
      return "MODEL_SELECTION_FAILURE";
  }
}
