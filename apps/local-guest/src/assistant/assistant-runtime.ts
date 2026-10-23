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
import {
  AssistantPackRegistry,
  composeSystemInstruction,
  MAX_ASSISTANT_TOOL_ROUNDS,
  PLATFORM_TASK_TOOLS,
  PLATFORM_TASK_TOOL_NAMES,
  TASK_START_EVENT,
  TASK_SWITCH_EVENT,
  type AssistantDomainPack,
  type AssistantTaskSummary,
  type AssistantToolContext,
  type AssistantReplyPlan,
  type AssistantReplyPlanKind,
} from "./assistant-platform.js";
import { createShortletAssistantPack } from "./shortlet-assistant-pack.js";
import { isProviderUnavailable } from "./fallback-model-client.js";
import {
  cloneTaskState,
  createInitialTaskState,
  type AssistantTask,
  type AssistantTaskState,
  type AssistantThreadState,
  type AssistantTurnSurface,
} from "./assistant-state.js";
import {
  isExplicitConfirmation,
  isExplicitCancellation,
  type PendingAssistantAction,
} from "./pending-actions.js";
import {
  ASSISTANT_CONFIRM_ACTION_EVENT,
  ASSISTANT_CANCEL_ACTION_EVENT,
} from "./pending-action-a2ui.js";

export interface AssistantTurnOutput {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly messages?: readonly string[];
  readonly surfaces?: readonly AssistantTurnSurface[];
  readonly tasks?: readonly AssistantTaskRailEntry[];
  readonly modelHandled?: boolean;
  readonly providerUnavailable?: boolean;
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
  | "function_result_round_trip";

export type AssistantFailureClass =
  | "PROVIDER_TRANSPORT_FAILURE"
  | "MODEL_SELECTION_FAILURE"
  | "INVALID_TOOL_FOR_STATE"
  | "APPLICATION_OPERATION_FAILURE"
  | "PROJECTION_FAILURE"
  | "A2UI_FAILURE"
  | "WEAVER_FAILURE";

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
}

export interface AssistantRuntimeOptions {
  readonly onDiagnostic?: (event: AssistantDiagnosticEvent) => void;
  /** Additional domain packs to register (used by hosts that host more than one domain). */
  readonly additionalPacks?: readonly AssistantDomainPack[];
  /** Maximum tokens for a final reply plan; engineering bound configured by the host. */
  readonly maxReplyOutputTokens?: number;
  readonly maxPlanningOutputTokens?: number;
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

const DISCOVERY_STAGE = "discovery";
const UNIT_STAGE = "unit";
const PENDING_ACTION_STAGE = "pending_action";
const REQUEST_STAGE = "request";
const OFFER_STAGE = "offer";
const PAYMENT_STAGE = "payment";
const BOOKING_STAGE = "booking";
export const DEFAULT_ASSISTANT_REPLY_MAX_OUTPUT_TOKENS = 128;
export const DEFAULT_ASSISTANT_PLANNING_MAX_OUTPUT_TOKENS = 1024;
const MAX_ASSISTANT_REPLY_OUTPUT_TOKENS = 4096;
const REPLY_PLAN_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["show_results", "show_details", "compare", "explain_price", "show_status", "propose_action", "clarify_stay", "redirect"] },
    references: { type: "array", items: { type: "string" } },
  },
  required: ["kind", "references"],
  additionalProperties: false,
} as const;

function parseReplyPlan(response: AssistantModelResponse, results: readonly AssistantToolResult[]): AssistantReplyPlan | undefined {
  if (response.toolCalls?.length || !response.text) return undefined;
  let value: unknown;
  try { value = JSON.parse(response.text); } catch { return undefined; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const kinds: readonly AssistantReplyPlanKind[] = ["show_results", "show_details", "compare", "explain_price", "show_status", "propose_action", "clarify_stay", "redirect"];
  if (Object.keys(record).length !== 2 || typeof record.kind !== "string" || !kinds.includes(record.kind as AssistantReplyPlanKind)
    || !Array.isArray(record.references) || !record.references.every((item) => typeof item === "string")) return undefined;
  const allowed = new Set(results.filter((result) => !result.isError).map((result) => result.name));
  if (record.references.some((reference) => !allowed.has(reference))) return undefined;
  return { kind: record.kind as AssistantReplyPlanKind, references: record.references as string[] };
}
export class AssistantRuntime {
  readonly #environment: LocalGuestEnvironment;
  readonly #modelClient: AssistantModelClient;
  readonly #onDiagnostic?: (event: AssistantDiagnosticEvent) => void;
  readonly #maxReplyOutputTokens: number;
  readonly #maxPlanningOutputTokens: number;
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
    this.#packs.register(createShortletAssistantPack(environment));
    for (const pack of options.additionalPacks ?? []) this.#packs.register(pack);
  }

  get #activePack(): AssistantDomainPack {
    return this.#packs.active;
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
      taskId: `task-${tasks.length + 1}`,
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

  async handleTurn(threadId: string, text: string): Promise<AssistantTurnOutput> {
    const thread = this.getThread(threadId);

    // 1. Transactional Candidates (Item 24)
    // Work on clones so provider/tool failures don't leave partial state
    let candidateTaskState = cloneTaskState(thread.taskState);
    let candidateActiveTaskId = thread.activeTaskId;
    const candidateTasks: AssistantTask[] = thread.tasks.map((task) => ({ ...task }));
    const candidateHistory: AssistantConversationStep[] = [...thread.conversationHistory];
    const candidateSurfaces: AssistantTurnSurface[] = [];
    let candidateActiveSurfaces = new Map<string, string>(thread.activeSurfaces);
    let candidateSuperseded = new Set<string>(thread.supersededSurfaces);
    let candidateLastSurfaces: readonly AssistantTurnSurface[] = thread.lastSurfaces;
    let candidateDiscoveryArtifactId = thread.discoveryArtifactId;

    // The active task decides the active pack: its tools, prompt and projections.
    const candidateDomain = () => candidateTasks.find((task) => task.taskId === candidateActiveTaskId)?.domain ?? this.#activePack.id;
    const candidatePack = () => this.#packs.packFor(candidateDomain()) ?? this.#activePack;
    const taskTools = () => this.#packs.size > 1
      ? [...PLATFORM_TASK_TOOLS, ...candidatePack().toolsForState(candidateTaskState)]
      : [...candidatePack().toolsForState(candidateTaskState)];

    const supersede = (stage: string) => {
      const surfaceId = candidateActiveSurfaces.get(stage);
      if (surfaceId) {
        candidateSuperseded.add(surfaceId);
        candidateActiveSurfaces.delete(stage);
      }
    };

    // 2. Check for Pending Action Confirmation in Natural Language (Item 13, 15)
    if (candidateTaskState.pendingAction && !candidateTaskState.pendingAction.executed) {
      if (isExplicitConfirmation(text)) {
        const execution = this.#executePendingAction(threadId, candidateTaskState.pendingAction, {
          candidateTaskState,
          candidateActiveSurfaces,
          candidateSuperseded,
          supersede,
        });

        if (!execution.ok) {
          return { ok: false, code: execution.code, message: execution.message };
        }

        // Action completed: commit state transaction
        thread.taskState = candidateTaskState;
        thread.conversationHistory.push({ role: "user", text });
        thread.conversationHistory.push({ role: "assistant", text: execution.message });
        thread.activeSurfaces = candidateActiveSurfaces;
        thread.supersededSurfaces = candidateSuperseded;
        thread.lastSurfaces = execution.surfaces.length > 0 ? execution.surfaces : candidateLastSurfaces;
        this.#syncActiveTask(thread);

        return {
          ok: true,
          messages: [execution.message],
          surfaces: execution.surfaces,
          tasks: this.getTaskRail(threadId),
        };
      }

      if (isExplicitCancellation(text)) {
        const action = candidateTaskState.pendingAction;
        candidateTaskState.pendingAction = null;
        supersede(PENDING_ACTION_STAGE);

        // Commit cancellation
        thread.taskState = candidateTaskState;
        thread.conversationHistory.push({ role: "user", text });
        thread.conversationHistory.push({ role: "assistant", text: "Action cancelled. Let me know how else I can help." });
        thread.activeSurfaces = candidateActiveSurfaces;
        thread.supersededSurfaces = candidateSuperseded;
        thread.lastSurfaces = candidateLastSurfaces;
        this.#syncActiveTask(thread);

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
      if (routed) return routed;
    }

    // 3. User message turn
    candidateHistory.push({ role: "user", text });

    const userTextHistory: string[] = candidateHistory
      .filter((s): s is Extract<AssistantConversationStep, { role: "user" }> => s.role === "user")
      .map((s) => s.text);

    let round = 0;
    let finalAssistantReply: string | undefined;
    let activeStage: AssistantDiagnosticStage = "provider_request";
    let activeToolName: string | undefined;
    let hasSuccessfulApplicationOperation = false;

    try {
      while (round < MAX_ASSISTANT_TOOL_ROUNDS) {
        round++;

        const isFunctionResultContinuation = round > 1 && candidateHistory.at(-1)?.role === "tool_results";
        activeStage = isFunctionResultContinuation ? "function_result_round_trip" : "provider_request";
        const modelResponse = await this.#modelClient.generate({
          systemInstruction: composeSystemInstruction(candidatePack()),
          tools: taskTools(),
          history: candidateHistory,
          timeoutMs: 20_000,
          structuredOutput: { name: "assistant_reply_plan", schema: REPLY_PLAN_SCHEMA, strict: true },
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
          const lastStep = candidateHistory.at(-1);
          const latestResults = lastStep?.role === "tool_results" ? lastStep.results : [];
          const plan = parseReplyPlan(modelResponse, latestResults);
          finalAssistantReply = candidatePack().renderReply?.(plan, latestResults, userTextHistory.at(-1) ?? "")
            ?? "I can help with your current request. Please review the information shown and tell me what you need next.";
          candidateHistory.push({ role: "assistant", text: finalAssistantReply });
          break;
        }

        // Record tool calls into history
        candidateHistory.push({
          role: "tool_calls",
          calls: modelResponse.toolCalls,
          ...(modelResponse.text === undefined && modelResponse.rawStep !== undefined ? { rawStep: modelResponse.rawStep } : {}),
        });

        const toolResults: AssistantToolResult[] = [];

        for (const call of modelResponse.toolCalls) {
          activeStage = "tool_execution";
          activeToolName = call.name;
          const offered = taskTools().some((tool) => tool.name === call.name);
          const precondition = this.#isPlatformTaskTool(call.name)
            ? undefined
            : candidatePack().validateToolCall(call.name, call.args, candidateTaskState);
          const invalidCall = precondition ?? (offered ? undefined : { code: "invalid_tool_for_state" as const, message: "That operation is not available for the current Guest workflow." });
          if (invalidCall) {
            this.#diagnose({
              stage: "tool_execution",
              round,
              toolName: call.name,
              succeeded: false,
              failureClass: invalidCall.code === "invalid_tool_for_state" ? "INVALID_TOOL_FOR_STATE" : "MODEL_SELECTION_FAILURE",
            });
            toolResults.push({
              callId: call.id,
              name: call.name,
              result: { error: invalidCall.code, message: invalidCall.message },
              isError: true,
            });
            continue;
          }
          if (this.#isPlatformTaskTool(call.name)) {
            const applied = this.#applyTaskTool(
              call.name,
              call.args,
              candidateTasks,
              candidateActiveTaskId,
              candidateTaskState,
              { activeSurfaces: candidateActiveSurfaces, supersededSurfaces: candidateSuperseded, lastSurfaces: candidateLastSurfaces },
            );
            candidateTaskState = applied.state;
            candidateActiveTaskId = applied.activeTaskId;
            candidateActiveSurfaces = applied.workspace.activeSurfaces;
            candidateSuperseded = applied.workspace.supersededSurfaces;
            candidateLastSurfaces = applied.workspace.lastSurfaces;
            toolResults.push({ callId: call.id, name: call.name, result: applied.result });
            continue;
          }
          const toolContext: AssistantToolContext = {
            environment: this.#environment,
            taskState: candidateTaskState,
            threadId,
            taskId: candidateActiveTaskId,
            userTextHistory,
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
            toolName: call.name,
            succeeded: true,
            ...(resultCount !== undefined ? { resultCount } : {}),
          });
          toolResults.push({
            callId: call.id,
            name: call.name,
            result: execution.result,
          });

          // Application projections are generated server-side from authoritative operation results.
          activeStage = "projection";
          if (call.name === "search_stays") {
            // Supersede any previous search or details
            supersede(DISCOVERY_STAGE);
            supersede(UNIT_STAGE);

            if (!execution.discoveryArtifact) {
              throw new Error("Authoritative discovery did not return an artifact");
            }
            candidateDiscoveryArtifactId = execution.discoveryArtifact.id;
            const surfaceId = `thread-${threadId}:discovery:${execution.discoveryArtifact.id}`;
            candidateActiveSurfaces.set(DISCOVERY_STAGE, surfaceId);
            activeStage = "a2ui";
            candidateSurfaces.push({
              surfaceId,
              a2uiMessages: candidatePack().discoverySurface(execution.discoveryArtifact, surfaceId),
            });
          } else if (call.name === "get_unit_details") {
            const stayRef = String(call.args.stayRef ?? "").trim();
            const stay = candidateTaskState.shortlist.find((s) => s.stayRef === stayRef);
            if (stay) {
              const surfaceId = `thread-${threadId}:unit:detail`;
              supersede(DISCOVERY_STAGE);
              supersede(UNIT_STAGE);
              candidateActiveSurfaces.set(UNIT_STAGE, surfaceId);

              const checkIn = candidateTaskState.stayIntent.checkIn ?? this.#environment.config.demoCheckIn;
              const checkOut = candidateTaskState.stayIntent.checkOut ?? this.#environment.config.demoCheckOut;
              if (!checkOut) throw new Error("The selected stay has no checkout date");
              activeStage = "a2ui";
              const a2uiMessages = candidatePack().unitDetailSurface({ unitId: stay.unitId, checkIn, checkOut, surfaceId });

              candidateSurfaces.push({ surfaceId, a2uiMessages });
            }
          } else if (execution.requestDraftSurface) {
            const surface = execution.requestDraftSurface;
            supersede(DISCOVERY_STAGE);
            supersede(UNIT_STAGE);
            supersede(REQUEST_STAGE);
            candidateActiveSurfaces.set(REQUEST_STAGE, surface.surfaceId);
            activeStage = "a2ui";
            candidateSurfaces.push({ surfaceId: surface.surfaceId, a2uiMessages: surface.a2uiMessages });
          } else if (execution.pendingActionCreated) {
            // Consequential action proposed -> create confirmation card surface
            const action = execution.pendingActionCreated;
            const surfaceId = `thread-${threadId}:pending-action:${action.id}`;
            supersede(PENDING_ACTION_STAGE);
            candidateActiveSurfaces.set(PENDING_ACTION_STAGE, surfaceId);

            activeStage = "a2ui";
            const a2uiMessages = candidatePack().pendingActionSurface(action, surfaceId);
            candidateSurfaces.push({ surfaceId, a2uiMessages });
          } else if (execution.projectedSurface) {
            const surface = execution.projectedSurface;
            const stage = `commerce:${surface.kind}`;
            supersede(stage);
            candidateActiveSurfaces.set(stage, surface.surfaceId);
            activeStage = "a2ui";
            candidateSurfaces.push({ surfaceId: surface.surfaceId, a2uiMessages: surface.a2uiMessages });
          }
        }

        candidateHistory.push({
          role: "tool_results",
          results: toolResults,
        });
        activeStage = "function_result_round_trip";
        activeToolName = undefined;
      }

      if (!finalAssistantReply) {
        // Run one final step to get summary reply if bounded rounds reached
        round++;
        activeStage = "function_result_round_trip";
        const finalModelResponse = await this.#modelClient.generate({
          systemInstruction: composeSystemInstruction(candidatePack()),
          tools: [],
          history: candidateHistory,
          structuredOutput: { name: "assistant_reply_plan", schema: REPLY_PLAN_SCHEMA, strict: true },
          maxOutputTokens: this.#maxReplyOutputTokens,
        });
        this.#diagnose({ stage: "provider_request", round, succeeded: true });
        this.#diagnose({ stage: "function_result_round_trip", round, succeeded: true });
        activeStage = "provider_response";
        this.#diagnose({ stage: activeStage, round, succeeded: true });
        const lastStep = candidateHistory.at(-1);
        const latestResults = lastStep?.role === "tool_results" ? lastStep.results : [];
        const plan = parseReplyPlan(finalModelResponse, latestResults);
        finalAssistantReply = candidatePack().renderReply?.(plan, latestResults, userTextHistory.at(-1) ?? "")
          ?? "I can help with your current request. Please review the information shown and tell me what you need next.";
        candidateHistory.push({ role: "assistant", text: finalAssistantReply });
      }

      // 4. Commit Transaction (Item 24)
      thread.taskState = candidateTaskState;
      thread.tasks = candidateTasks;
      thread.activeTaskId = candidateActiveTaskId;
      thread.conversationHistory.length = 0;
      thread.conversationHistory.push(...candidateHistory);
      thread.activeSurfaces = candidateActiveSurfaces;
      thread.supersededSurfaces = candidateSuperseded;
      thread.lastSurfaces = candidateSurfaces.length > 0 ? candidateSurfaces : candidateLastSurfaces;
      thread.discoveryArtifactId = candidateDiscoveryArtifactId;
      this.#syncActiveTask(thread);

      return {
        ok: true,
        messages: [finalAssistantReply],
        surfaces: candidateSurfaces,
        tasks: this.getTaskRail(threadId),
        modelHandled: true,
      };
    } catch (error) {
      this.#diagnose(createFailureDiagnostic(activeStage, round, activeToolName, error));
      if (hasSuccessfulApplicationOperation && candidateSurfaces.length > 0) {
        const message = fallbackForProjectedOperation(candidateSurfaces[0]?.surfaceId ?? "");
        candidateHistory.push({ role: "assistant", text: message });
        thread.taskState = candidateTaskState;
        thread.tasks = candidateTasks;
        thread.activeTaskId = candidateActiveTaskId;
        thread.conversationHistory.length = 0;
        thread.conversationHistory.push(...candidateHistory);
        thread.activeSurfaces = candidateActiveSurfaces;
        thread.supersededSurfaces = candidateSuperseded;
        thread.lastSurfaces = candidateSurfaces;
        thread.discoveryArtifactId = candidateDiscoveryArtifactId;
        this.#syncActiveTask(thread);
        return { ok: true, messages: [message], surfaces: candidateSurfaces, tasks: this.getTaskRail(threadId), modelHandled: true };
      }
      // Rollback: thread is not mutated on error
      return {
        ok: false,
        code: "CONCIERGE_UNAVAILABLE",
        message: "The concierge is temporarily unavailable. Please try again.",
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

  /** Mirrors the thread's active workspace back onto the active task object. */
  #syncActiveTask(thread: AssistantThreadState): void {
    const active = thread.tasks.find((task) => task.taskId === thread.activeTaskId);
    if (!active) return;
    active.state = thread.taskState;
    active.activeSurfaces = thread.activeSurfaces;
    active.supersededSurfaces = thread.supersededSurfaces;
    active.lastSurfaces = thread.lastSurfaces;
  }

  handleAssistantEvent(threadId: string, eventName: string, context: AssistantEventContext | null | undefined): AssistantTurnOutput {
    const thread = this.getThread(threadId);
    const candidateTasks = thread.tasks.map((task) => ({ ...task }));
    let candidateTaskState = cloneTaskState(thread.taskState);
    let candidateActiveSurfaces = new Map<string, string>(thread.activeSurfaces);
    let candidateSuperseded = new Set<string>(thread.supersededSurfaces);
    let candidateLastSurfaces: readonly AssistantTurnSurface[] = thread.lastSurfaces;
    const candidateSurfaces: AssistantTurnSurface[] = [];

    const supersede = (stage: string) => {
      const surfaceId = candidateActiveSurfaces.get(stage);
      if (surfaceId) {
        candidateSuperseded.add(surfaceId);
        candidateActiveSurfaces.delete(stage);
      }
    };

    if (eventName === TASK_START_EVENT || eventName === TASK_SWITCH_EVENT) {
      const applied = this.#applyTaskTool(
        eventName === TASK_SWITCH_EVENT ? "switch_task" : "start_task",
        { domain: context?.domain, taskId: context?.taskId },
        candidateTasks,
        thread.activeTaskId,
        candidateTaskState,
        { activeSurfaces: candidateActiveSurfaces, supersededSurfaces: candidateSuperseded, lastSurfaces: candidateLastSurfaces },
      );
      const error = applied.result.error;
      if (typeof error === "string") {
        return { ok: false, code: error, message: String(applied.result.message ?? "That task could not be opened.") };
      }
      candidateTaskState = applied.state;
      candidateActiveSurfaces = applied.workspace.activeSurfaces;
      candidateSuperseded = applied.workspace.supersededSurfaces;
      candidateLastSurfaces = applied.workspace.lastSurfaces;

      thread.taskState = candidateTaskState;
      thread.tasks = candidateTasks;
      thread.activeTaskId = applied.activeTaskId;
      thread.activeSurfaces = candidateActiveSurfaces;
      thread.supersededSurfaces = candidateSuperseded;
      thread.lastSurfaces = candidateLastSurfaces;
      this.#syncActiveTask(thread);

      const activeDomain = candidateTasks.find((task) => task.taskId === applied.activeTaskId)?.domain;
      const activeLabel = (activeDomain ? this.#packs.packFor(activeDomain) : undefined)?.label ?? "new";
      const message = eventName === TASK_SWITCH_EVENT
        ? `Switched to your ${activeLabel} task.`
        : `Started a ${activeLabel} task.`;

      return {
        ok: true,
        messages: [message],
        surfaces: candidateLastSurfaces,
        tasks: this.getTaskRail(threadId),
      };
    }

    const actionTask = candidateTasks.find((task) => task.taskId === thread.activeTaskId);
    const actionPack = actionTask ? this.#packs.packFor(actionTask.domain) : undefined;
    if (actionPack?.platformActionNames?.includes(eventName)) {
      const activeTask = actionTask;
      const pack = actionPack;
      const activeSurfaceId = candidateActiveSurfaces.get("commerce:checkout");
      if (activeTask?.domain !== "commerce" || !pack?.handlePlatformAction || !activeSurfaceId || context?.surfaceId !== activeSurfaceId || context.taskId !== activeTask.taskId) {
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
      supersede("commerce:checkout");
      const resultSurfaces = result.surface ? [result.surface] : [];
      if (result.surface) {
        candidateActiveSurfaces.set("commerce:checkout", result.surface.surfaceId);
        candidateSurfaces.push(result.surface);
      }
      thread.activeSurfaces = candidateActiveSurfaces;
      thread.supersededSurfaces = candidateSuperseded;
      thread.lastSurfaces = resultSurfaces.length > 0 ? resultSurfaces : candidateLastSurfaces;
      this.#syncActiveTask(thread);
      return { ok: true, messages: [result.message], surfaces: resultSurfaces, tasks: this.getTaskRail(threadId) };
    }

    if (eventName === ASSISTANT_CONFIRM_ACTION_EVENT || eventName === ASSISTANT_CANCEL_ACTION_EVENT) {
      // ADR-0074: only the current authoritative surface retains action authority.
      const activeSurfaceId = candidateActiveSurfaces.get(PENDING_ACTION_STAGE);
      if (!activeSurfaceId || context?.surfaceId !== activeSurfaceId) {
        return { ok: false, code: "STALE_SURFACE", message: "That action is no longer active." };
      }
    }

    if (eventName === ASSISTANT_CANCEL_ACTION_EVENT) {
      if (!candidateTaskState.pendingAction || candidateTaskState.pendingAction.id !== context?.actionId) {
        return { ok: false, code: "STALE_SURFACE", message: "That action is no longer active." };
      }
      candidateTaskState.pendingAction = null;
      supersede(PENDING_ACTION_STAGE);

      thread.taskState = candidateTaskState;
      thread.activeSurfaces = candidateActiveSurfaces;
      thread.supersededSurfaces = candidateSuperseded;
      thread.lastSurfaces = candidateLastSurfaces;
      this.#syncActiveTask(thread);

      return {
        ok: true,
        messages: ["Action cancelled."],
        surfaces: [],
        tasks: this.getTaskRail(threadId),
      };
    }

    if (eventName === ASSISTANT_CONFIRM_ACTION_EVENT) {
      const action = candidateTaskState.pendingAction;
      if (!action || action.id !== context?.actionId || action.executed) {
        return { ok: false, code: "STALE_SURFACE", message: "That action is no longer active." };
      }

      const execution = this.#executePendingAction(threadId, action, {
        candidateTaskState,
        candidateActiveSurfaces,
        candidateSuperseded,
        supersede,
      });

      if (!execution.ok) {
        return { ok: false, code: execution.code, message: execution.message };
      }

      thread.taskState = candidateTaskState;
      thread.activeSurfaces = candidateActiveSurfaces;
      thread.supersededSurfaces = candidateSuperseded;
      thread.lastSurfaces = execution.surfaces.length > 0 ? execution.surfaces : candidateLastSurfaces;
      this.#syncActiveTask(thread);

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
    context: {
      candidateTaskState: AssistantTaskState;
      candidateActiveSurfaces: Map<string, string>;
      candidateSuperseded: Set<string>;
      supersede: (stage: string) => void;
    },
  ): { ok: true; message: string; surfaces: { surfaceId: string; a2uiMessages: readonly unknown[] }[] } | { ok: false; code: string; message: string } {
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

    context.supersede(PENDING_ACTION_STAGE);

    switch (action.type) {
      case "request_to_book": {
        const refs = action.authoritativeReferences;
        if (!refs.unitId || !refs.checkIn || !refs.checkOut) {
          return { ok: false, code: "INVALID_CONTEXT", message: "Incomplete booking details." };
        }

        const environment = this.#environment;
        const guest: CommandPrincipal = environment.guestPrincipal();

        // Pre-execution revalidation: re-read current Unit/discovery truth for the same Unit, dates, and party size.
        const verdict = this.#packForThread(threadId).revalidateProposal(action);
        if (!verdict.ok) {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: verdict.code, message: verdict.message };
        }

        const draft = environment.bookingRequestApp.createDraft(
          {
            unitId: refs.unitId,
            primaryGuest: { id: environment.config.guestId, name: environment.config.guestName },
            occupants: environment.demoOccupants(refs.partySize ?? 1),
            selfBookingAttestation: environment.selfBookingAttestation(),
            checkIn: refs.checkIn,
            checkOut: refs.checkOut,
          },
          guest,
        );

        const disclosed = environment.bookingRequestApp.disclose(draft.draftId, guest);

        // POST-AUTHORITATIVE-COMMIT RECONCILIATION:
        // Booking request has committed. Record it authoritatively in working state.
        context.candidateTaskState.currentBookingRequestId = disclosed.requestId;
        context.candidateTaskState.goal = "book_stay";
        context.candidateTaskState.pendingAction = null;

        const requestSurfaceId = `thread-${threadId}:request:${disclosed.requestId}`;
        context.supersede(UNIT_STAGE);
        context.candidateActiveSurfaces.set(REQUEST_STAGE, requestSurfaceId);

        let requestArtifact: ReturnType<typeof environment.bookingRequestApp.getArtifact>;
        try {
          requestArtifact = environment.bookingRequestApp.getArtifact(disclosed.requestId, guest);
        } catch {
          // If artifact presentation read fails, retain authoritative commit truth
          return {
            ok: true,
            message: "Your booking request has been submitted to the host. You can check status at any time.",
            surfaces: [],
          };
        }

        // ADR 0041: production disclosure must wait for an authorized Operator's real confirmation. ADR 0105: the staging demo
        // is the only exception, and it accepts through the operator command path rather than the fixture simulator.
        if (environment.config.production && environment.config.demoRequestAcceptor?.delaySeconds !== 0) {
          return {
            ok: true,
            message: "Your booking request has been submitted to the host and is awaiting review.",
            surfaces: [
              {
                surfaceId: requestSurfaceId,
                a2uiMessages: this.#packForThread(threadId).bookingRequestSurface(requestArtifact, requestSurfaceId),
              },
            ],
          };
        }

        // Attempt local operator simulation
        try {
          const { offerId } = environment.config.demoRequestAcceptor === undefined
            ? environment.simulateOperatorAcceptance(disclosed.requestId)
            : environment.acceptDisclosedRequest(disclosed.requestId);
          context.candidateTaskState.currentOfferId = offerId;
          const offerSurfaceId = `thread-${threadId}:offer:${offerId}`;
          context.candidateActiveSurfaces.set(OFFER_STAGE, offerSurfaceId);

          const offerArtifact = environment.conditionalOfferApp.getArtifact(offerId, guest);

          return {
            ok: true,
            message: "The host has accepted your request. Here is your booking offer.",
            surfaces: [
              {
                surfaceId: requestSurfaceId,
                a2uiMessages: this.#packForThread(threadId).bookingRequestSurface(requestArtifact, requestSurfaceId),
              },
              {
                surfaceId: offerSurfaceId,
                a2uiMessages: this.#packForThread(threadId).conditionalOfferSurface(offerArtifact, offerSurfaceId),
              },
            ],
          };
        } catch {
          // If operator simulation or offer presentation fails, DO NOT pretend booking request was rolled back.
          // Disclose committed, request exists. Check if operator confirmed it before failure.
          let statusMessage = "Your booking request has been submitted to the host and is awaiting review.";
          try {
            const currentReq = environment.bookingRequestApp.getArtifact(disclosed.requestId, guest);
            if (currentReq.facts.status === "confirmed") {
              statusMessage = "Your booking request has been confirmed by the host. Preparing your booking offer.";
            }
          } catch {
            // Keep default message if read fails
          }
          return {
            ok: true,
            message: statusMessage,
            surfaces: [
              {
                surfaceId: requestSurfaceId,
                a2uiMessages: this.#packForThread(threadId).bookingRequestSurface(requestArtifact, requestSurfaceId),
              },
            ],
          };
        }
      }

      case "accept_offer": {
        const refs = action.authoritativeReferences;
        const offerId = refs.offerId;
        if (!offerId) {
          return { ok: false, code: "INVALID_ARTIFACT", message: "No offer reference found." };
        }

        const offerArtifact = this.#environment.conditionalOfferApp.getArtifact(offerId, this.#environment.guestPrincipal());
        if (refs.offerStatus !== offerArtifact.facts.status
          || refs.offerVersion !== offerArtifact.facts.offerVersion
          || refs.projectionVersion !== offerArtifact.projectionVersion
          || refs.stayTotalKobo !== offerArtifact.facts.allInStayTotalKobo
          || refs.refundableDepositKobo !== offerArtifact.facts.refundableSecurityDepositKobo
          || refs.totalDueNowKobo !== offerArtifact.facts.totalAmountDueNowKobo) {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "STALE_SURFACE", message: "The offer changed. Review the current offer before accepting." };
        }
        const acceptAction = offerArtifact.actions.find((a) => a.type === "accept");
        if (!acceptAction) {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "ACTION_NOT_AUTHORIZED", message: "Offer cannot be accepted in current state." };
        }

        // Accept offer through authoritative application command
        this.#environment.conditionalOfferApp.accept({
          offerId,
          confirmationToken: acceptAction.confirmationToken,
          expectedVersion: acceptAction.offerVersion,
          principal: this.#environment.guestPrincipal(),
        });

        // POST-AUTHORITATIVE-COMMIT RECONCILIATION:
        // Offer acceptance committed. Pending action consumed, cannot replay.
        context.candidateTaskState.pendingAction = null;

        const paymentSurfaceId = `thread-${threadId}:payment:${offerId}`;
        context.supersede(OFFER_STAGE);
        context.candidateActiveSurfaces.set(PAYMENT_STAGE, paymentSurfaceId);

        try {
          const paymentArtifact = this.#environment.cardPaymentApp.getArtifact(offerId, this.#environment.guestPrincipal());
          return {
            ok: true,
            message: "Offer accepted. Complete the secure card payment to confirm your booking.",
            surfaces: [
              {
                surfaceId: paymentSurfaceId,
                a2uiMessages: this.#packForThread(threadId).cardPaymentSurface(paymentArtifact, paymentSurfaceId),
              },
            ],
          };
        } catch {
          // If payment presentation fails, retain accepted state authoritatively
          return {
            ok: true,
            message: "Offer accepted successfully. Proceed to payment checkout.",
            surfaces: [],
          };
        }
      }

      case "start_checkout": {
        const refs = action.authoritativeReferences;
        const offerId = refs.offerId;
        if (!offerId) {
          return { ok: false, code: "INVALID_ARTIFACT", message: "No payment reference found." };
        }

        // Revalidate start_checkout against current authoritative card-payment artifact
        let paymentArtifact;
        try {
          paymentArtifact = this.#environment.cardPaymentApp.getArtifact(offerId, this.#environment.guestPrincipal());
        } catch {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "STALE_SURFACE", message: "Payment checkout is no longer available for this offer." };
        }

        if (refs.offerId !== offerId
          || (refs.projectionVersion !== undefined && refs.projectionVersion !== paymentArtifact.projectionVersion)
          || (refs.stayTotalKobo !== undefined && refs.stayTotalKobo !== paymentArtifact.facts.allInStayTotalKobo)
          || (refs.refundableDepositKobo !== undefined && refs.refundableDepositKobo !== paymentArtifact.facts.refundableSecurityDepositKobo)
          || (refs.totalDueNowKobo !== undefined && refs.totalDueNowKobo !== paymentArtifact.facts.amountDueNowKobo)) {
          context.candidateTaskState.pendingAction = null;
          return { ok: false, code: "STALE_SURFACE", message: "Payment details or amounts have changed. Please review the updated checkout." };
        }

        let session = this.#environment.cardPaymentApp.getCheckoutSession(offerId);
        if (!session) {
          session = this.#environment.cardPaymentApp.initializeCheckout(offerId, this.#environment.guestPrincipal());
        }

        let outcome = this.#environment.cardPaymentApp.verifyAndConfirm(session.pspReference, this.#environment.systemPrincipal());
        if (outcome.outcome === "deposit_required") {
          session = this.#environment.cardPaymentApp.initializeCheckout(offerId, this.#environment.guestPrincipal());
          outcome = this.#environment.cardPaymentApp.verifyAndConfirm(session.pspReference, this.#environment.systemPrincipal());
        }

        if (outcome.outcome !== "confirmed") {
          return { ok: false, code: "PAYMENT_NOT_CONFIRMED", message: "Payment could not be completed." };
        }

        // Authoritatively commit to contract repository
        this.#environment.contractRepository.recordConfirmedOutcome(outcome.reservation, outcome.bookingContract);

        // POST-AUTHORITATIVE-COMMIT RECONCILIATION:
        // Payment committed. Reservation and contract recorded. Action consumed, cannot replay.
        const contractId = outcome.bookingContract.contractId;
        context.candidateTaskState.currentReservationId = outcome.reservation.reservationId;
        context.candidateTaskState.currentContractId = contractId;
        context.candidateTaskState.pendingAction = null;

        const paymentSurfaceId = `thread-${threadId}:payment:confirmed:${offerId}`;
        const bookingSurfaceId = `thread-${threadId}:booking:${contractId}`;
        context.supersede(PAYMENT_STAGE);
        context.candidateActiveSurfaces.set(BOOKING_STAGE, bookingSurfaceId);

        try {
          const updatedPaymentArtifact = this.#environment.cardPaymentApp.getArtifact(offerId, this.#environment.guestPrincipal());
          const contractArtifact = this.#environment.contractApp.getArtifact(contractId, this.#environment.guestPrincipal());

          return {
            ok: true,
            message: "Payment complete. Your booking is confirmed.",
            surfaces: [
              {
                surfaceId: paymentSurfaceId,
                a2uiMessages: this.#packForThread(threadId).cardPaymentSurface(updatedPaymentArtifact, paymentSurfaceId),
              },
              {
                surfaceId: bookingSurfaceId,
                a2uiMessages: this.#packForThread(threadId).bookingContractSurface(contractArtifact, bookingSurfaceId),
              },
            ],
          };
        } catch {
          // If contract/payment presentation fails, payment/contract truth is retained
          return {
            ok: true,
            message: `Payment complete. Your booking is confirmed under contract reference ${contractId}.`,
            surfaces: [],
          };
        }
      }

      default:
        return { ok: false, code: "UNSUPPORTED_ACTION", message: "Unsupported action." };
    }
  }
}

function getSafeResultCount(result: unknown): number | undefined {
  if (typeof result !== "object" || result === null || !("resultCount" in result)) return undefined;
  const count = result.resultCount;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
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
  const safeCode = typeof codeCandidate === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(codeCandidate)
    ? codeCandidate
    : undefined;
  return {
    stage,
    round,
    succeeded: false,
    ...(toolName ? { toolName } : {}),
    errorClass: error instanceof Error ? error.constructor.name : typeof error,
    failureClass: classifyFailure(stage, error),
    ...(safeStatus !== undefined ? { providerStatusCode: safeStatus } : {}),
    ...(safeCode !== undefined ? { providerErrorCode: safeCode } : {}),
  };
}

function classifyFailure(stage: AssistantDiagnosticStage, error: unknown): AssistantFailureClass {
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

function fallbackForProjectedOperation(surfaceId: string): string {
  if (surfaceId.includes(":discovery:")) return "Your current search results are ready below. You can refine them or open a stay.";
  if (surfaceId.includes(":unit:")) return "The selected stay details are ready below.";
  if (surfaceId.includes(":request:draft:")) return "Your Request Draft is ready to review below. It has not been submitted.";
  return "The requested information is ready below.";
}
