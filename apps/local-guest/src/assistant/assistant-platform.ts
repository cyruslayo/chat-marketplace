import type { AssistantToolDefinition, AssistantToolResult } from "./assistant-model.js";
import type { AssistantStageHandler } from "./assistant-stage-handler.js";
import type { ConciergeIntent } from "./scope-classifier.js";
import type { AssistantTaskState, AssistantTurnSurface } from "./assistant-state.js";
import type { PendingAssistantAction } from "./pending-actions.js";
import type { LocalGuestEnvironment } from "../fixture.js";
import type { CommandPrincipal } from "../../../../packages/platform-core/src/envelope.js";
import { MAX_PLANNER_TOOL_ROUNDS } from "../turn-budget.js";

/**
 * The platform half of the concierge agent (ADR 0099: the platform owns the Agent; a pack
 * supplies its prompt section, tools and surfaces). Everything here is domain-agnostic; the
 * shortlet pack lives in `shortlet-assistant-pack.ts`.
 */

/** Bounded tool rounds: the loop never runs longer than this. The value is shared with the browser's turn budget. */
export const MAX_ASSISTANT_TOOL_ROUNDS = MAX_PLANNER_TOOL_ROUNDS;

/** The domain-agnostic preamble the runtime prefixes to every pack's prompt section. */
export const ASSISTANT_PLATFORM_PREAMBLE = `You are the Shortlet Guest Assistant.
You assist guests with discovering accommodation, answering questions about stays and pricing, and preparing booking actions.
Use tools for current facts and actions. When you have no tool call, return only the requested typed reply plan. Do not write guest-facing prose.`;

export interface AssistantToolPreconditionFailure {
  readonly code: "invalid_tool_for_state" | "invalid_reference" | "invalid_arguments";
  readonly message: string;
}

export interface AssistantToolContext {
  readonly environment: LocalGuestEnvironment;
  readonly taskState: AssistantTaskState;
  readonly threadId: string;
  readonly taskId: string;
  readonly userTextHistory: readonly string[];
  readonly currentTurnDates?: { readonly checkIn?: string; readonly checkOut?: string };
  readonly now: Date;
  readonly demoCheckIn: string;
  readonly onSearchExecuted?: (filters: {
    location: string;
    neighbourhood?: string;
    checkIn: string;
    checkOut: string;
    partySize: number;
  }) => { readonly surfaceId: string; readonly artifactId: string; readonly unitProjections: readonly unknown[] };
}

export const ASSISTANT_CONTROL_OUTCOMES = [
  "scope_redirect", "scope_unavailable", "quota_refusal", "guard_failure", "rejected_plan_fallback",
  "support_guidance", "no_current_booking", "successful_model_handling", "model_handling_failure", "tool_denial",
] as const;
export type AssistantControlOutcome = typeof ASSISTANT_CONTROL_OUTCOMES[number];

/** ADR 0106/0079: a closed code for one application effect this turn produced. Diagnostics only. */
export type AssistantToolEffectCode = "request_draft_created_availability_checked_not_reserved";

export interface AssistantToolExecutionResult {
  readonly result: Record<string, unknown>;
  readonly updatedTaskState: AssistantTaskState;
  readonly pendingActionCreated?: PendingAssistantAction;
  readonly discoveryArtifact?: { readonly id: string };
  readonly searchSurfacePayload?: { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] };
  readonly requestDraftSurface?: { readonly draftId: string; readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] };
  readonly projectedSurface?: { readonly kind: "discovery" | "cart" | "checkout" | "order"; readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] };
  /** Diagnostics only: the closed effect code of this execution, set by the pack that ran it (issue 04). */
  readonly effectCode?: AssistantToolEffectCode;
}

export interface AssistantSurfaceMessages {
  readonly surfaceId: string;
  readonly a2uiMessages: readonly unknown[];
}

/** Closed model choice. Facts and guest wording stay in the active pack. */
export type AssistantReplyPlanKind = "show_results" | "show_details" | "compare" | "explain_price" | "show_status" | "propose_action" | "clarify_stay" | "redirect" | "support_guidance";

export interface AssistantReplyPlan {
  readonly kind: AssistantReplyPlanKind;
  readonly references: readonly string[];
}

/** One task's place in the shell task rail: a domain label plus its current step. */
export interface AssistantTaskSummary {
  readonly label: string;
  readonly status: string;
  readonly tone?: "info" | "success" | "warning" | "danger";
}

/**
 * A domain pack for the concierge agent: its prompt section, its tools and its projections.
 * The runtime composes the instruction from the platform preamble plus the active pack's
 * section and exposes only the active pack's tools (ADR 0073/0099).
 */
export interface AssistantDomainPack {
  readonly id: string;
  /** The vertical's display name, e.g. "Stays" or "Shop" (ADR 0077: one copy source). */
  readonly label: string;
  /** One line for the vertical starter card; omitted when there is no starter. */
  readonly starterDescription?: string;
  readonly promptSection: string;
  readonly scopeDescription?: string;
  /** Fixed guest copy that asks for dates in a supported form when a planner date is not guest-authored (ADR 0106). */
  readonly dateClarification?: string;
  /** Fixed guest copy that asks for missing stay details (nights, party size) when a planner search omits them (ADR 0106). */
  readonly stayDetailsClarification?: string;
  /** Canonical structured location values; external narrative is excluded. */
  readonly scopeLocations?: readonly string[];
  /** Words that signal the user is asking for this domain, used by the router. */
  readonly intentKeywords: readonly string[];
  readonly toolNames: readonly string[];
  /** Pack-owned mapping from validated turn intents to tools. Missing maps grant no pack tools. */
  readonly toolIntentMap?: Readonly<Partial<Record<ConciergeIntent, readonly string[]>>>;
  /** Full declared schema for a pack tool, including tools unavailable in the current state. */
  toolDefinition?(name: string): AssistantToolDefinition | undefined;
  /** Domain-owned consequential action names routed to this pack's platform command adapter. */
  readonly platformActionNames?: readonly string[];
  toolsForState(taskState: AssistantTaskState): readonly AssistantToolDefinition[];
  validateToolCall(name: string, args: Record<string, unknown>, taskState: AssistantTaskState): AssistantToolPreconditionFailure | undefined;
  executeTool(name: string, args: Record<string, unknown>, context: AssistantToolContext): AssistantToolExecutionResult;
  /** Pack-owned minimal facts for model history. Raw execution results remain local to the platform. */
  projectToolResult?(name: string, result: Record<string, unknown>, limits: { readonly maxItems: number }): Record<string, unknown>;
  /** Canonical bounded facts used when older operation pairs leave retained history. */
  projectStateSummary?(taskState: AssistantTaskState, limits: { readonly maxItems: number }): Record<string, unknown>;
  /** Where a task in this domain is right now, for the shell task rail. */
  taskSummary(taskState: AssistantTaskState): AssistantTaskSummary;
  /** Projections the runtime renders for this pack's authoritative results. */
  discoverySurface(artifact: unknown, surfaceId: string): readonly unknown[];
  unitDetailSurface(input: { readonly unitId: string; readonly checkIn: string; readonly checkOut: string; readonly surfaceId: string }): readonly unknown[];
  pendingActionSurface(action: PendingAssistantAction, surfaceId: string): readonly unknown[];
  bookingRequestSurface(artifact: unknown, surfaceId: string): readonly unknown[];
  conditionalOfferSurface(artifact: unknown, surfaceId: string): readonly unknown[];
  cardPaymentSurface(artifact: unknown, surfaceId: string): readonly unknown[];
  bookingContractSurface(artifact: unknown, surfaceId: string): readonly unknown[];
  /** Validates references and renders a reply from current server-owned operation data. */
  renderReply?(plan: AssistantReplyPlan | undefined, results: readonly AssistantToolResult[], latestUserText: string): string;
  /** A control outcome the pack's current results imply for a reply (for example no current booking). Undefined keeps the runtime's outcome. */
  replyControlOutcome?(results: readonly AssistantToolResult[]): AssistantControlOutcome | undefined;
  /** Issue 04: the pack's stage handlers, called in order for each authoritative execution and for confirmed pending actions. */
  readonly stageHandlers?: readonly AssistantStageHandler[];
  /**
   * ADR 0074 (issue 04 decision b): whether an open proposal still names the stay this pack's search holds. A pack that does not
   * supply it is treated as not authorising the proposal (fail closed, see pendingProposalAuthorised).
   */
  proposalStillAuthorised?(action: PendingAssistantAction, taskState: AssistantTaskState): boolean;
  /** Re-reads authoritative truth before a proposed booking request is confirmed. */
  revalidateProposal(action: PendingAssistantAction): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string };
  /** Optional pack-owned command adapter; the pack must route through the platform ActionSpec gate. */
  handlePlatformAction?(input: { readonly actionName: string; readonly context: Record<string, unknown>; readonly principal: CommandPrincipal; readonly taskId: string; readonly activeSurfaceId?: string }): { readonly ok: true; readonly message: string; readonly surface?: AssistantTurnSurface } | { readonly ok: false; readonly code: string; readonly message: string };
}

/**
 * ADR 0074: no open proposal is authorised by default. With no proposal the answer is true; with a proposal, only the pack's own
 * hook can keep it, and a pack without the hook does not.
 */
export function pendingProposalAuthorised(pack: AssistantDomainPack, state: AssistantTaskState): boolean {
  if (!state.pendingAction) return true;
  return pack.proposalStillAuthorised?.(state.pendingAction, state) === true;
}

/** Returns only tools declared for both validated intents and the pack's current state. */
export function toolsForValidatedIntents(
  pack: AssistantDomainPack,
  taskState: AssistantTaskState,
  intents: readonly ConciergeIntent[],
): readonly AssistantToolDefinition[] {
  const authorizedNames = toolNamesForValidatedIntents(pack, intents);
  return pack.toolsForState(taskState).filter((tool) => pack.toolNames.includes(tool.name) && authorizedNames.has(tool.name));
}

export function toolNamesForValidatedIntents(pack: AssistantDomainPack, intents: readonly ConciergeIntent[]): ReadonlySet<string> {
  if (!pack.toolIntentMap) return new Set();
  return new Set(pack.toolNames.filter((name) => intents.some((intent) => pack.toolIntentMap?.[intent]?.includes(name) === true)));
}

export function composeSystemInstruction(pack: AssistantDomainPack): string {
  return `${ASSISTANT_PLATFORM_PREAMBLE}\n${pack.promptSection}`;
}

/** Platform-owned tools that manage conversation tasks; offered only when more than one domain is registered. */
export const START_TASK_TOOL: AssistantToolDefinition = {
  name: "start_task",
  description: "Start a new task in another domain. Requires guest confirmation before switching.",
  category: "read",
  parametersSchema: {
    type: "object",
    properties: { domain: { type: "string", description: "Registered domain id, e.g. 'shop'" } },
    required: ["domain"],
    additionalProperties: false,
  },
};

export const SWITCH_TASK_TOOL: AssistantToolDefinition = {
  name: "switch_task",
  description: "Switch to an existing task in this conversation.",
  category: "read",
  parametersSchema: {
    type: "object",
    properties: { taskId: { type: "string", description: "The task id to activate" } },
    required: ["taskId"],
    additionalProperties: false,
  },
};

/** Shell-owned events for the task rail and vertical starters; they reuse the same task logic as the tools. */
export const TASK_START_EVENT = "platform.task.start";
export const TASK_SWITCH_EVENT = "platform.task.switch";

export const PLATFORM_TASK_TOOLS: readonly AssistantToolDefinition[] = [START_TASK_TOOL, SWITCH_TASK_TOOL];
export const PLATFORM_TASK_TOOL_NAMES: readonly string[] = PLATFORM_TASK_TOOLS.map((tool) => tool.name);

export class AssistantPackRegistry {
  readonly #packs = new Map<string, AssistantDomainPack>();
  #activeId: string | undefined;

  register(pack: AssistantDomainPack): void {
    this.#packs.set(pack.id, pack);
    this.#activeId ??= pack.id;
  }

  get size(): number {
    return this.#packs.size;
  }

  ids(): readonly string[] {
    return [...this.#packs.keys()];
  }

  packFor(id: string): AssistantDomainPack | undefined {
    return this.#packs.get(id);
  }

  get active(): AssistantDomainPack {
    const pack = this.#activeId === undefined ? undefined : this.#packs.get(this.#activeId);
    if (!pack) throw new Error("No assistant domain pack is registered");
    return pack;
  }

  activate(id: string): void {
    if (!this.#packs.has(id)) throw new Error(`Unknown assistant domain pack: ${id}`);
    this.#activeId = id;
  }

  hasTool(name: string): boolean {
    return this.#packs.get(this.#activeId ?? "")?.toolNames.includes(name) ?? false;
  }

  /** Tool names the active pack offers given the current task state. */
  toolNamesForState(taskState: AssistantTaskState): readonly string[] {
    return this.active.toolsForState(taskState).map((tool) => tool.name);
  }
}
