import type { AssistantToolDefinition } from "./assistant-model.js";
import type { AssistantTaskState, AssistantTurnSurface } from "./assistant-state.js";
import type { PendingAssistantAction } from "./pending-actions.js";
import type { LocalGuestEnvironment } from "../fixture.js";
import type { CommandPrincipal } from "../../../../packages/platform-core/src/envelope.js";

/**
 * The platform half of the concierge agent (ADR 0099: the platform owns the Agent; a pack
 * supplies its prompt section, tools and surfaces). Everything here is domain-agnostic; the
 * shortlet pack lives in `shortlet-assistant-pack.ts`.
 */

/** Bounded tool rounds: the loop never runs longer than this. */
export const MAX_ASSISTANT_TOOL_ROUNDS = 4;

/** The domain-agnostic preamble the runtime prefixes to every pack's prompt section. */
export const ASSISTANT_PLATFORM_PREAMBLE = `You are the Shortlet Guest Assistant.
You assist guests with discovering accommodation, answering questions about stays and pricing, and preparing booking actions.
Use tools for current facts and actions. When you have no tool call, return only the requested typed reply plan. Do not write guest-facing prose.`;

export interface AssistantToolPreconditionFailure {
  readonly code: "invalid_tool_for_state" | "invalid_reference";
  readonly message: string;
}

export interface AssistantToolContext {
  readonly environment: LocalGuestEnvironment;
  readonly taskState: AssistantTaskState;
  readonly threadId: string;
  readonly taskId: string;
  readonly userTextHistory: readonly string[];
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

export interface AssistantToolExecutionResult {
  readonly result: Record<string, unknown>;
  readonly updatedTaskState: AssistantTaskState;
  readonly pendingActionCreated?: PendingAssistantAction;
  readonly discoveryArtifact?: { readonly id: string };
  readonly searchSurfacePayload?: { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] };
  readonly requestDraftSurface?: { readonly draftId: string; readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] };
  readonly projectedSurface?: { readonly kind: "discovery" | "cart" | "checkout" | "order"; readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] };
}

export interface AssistantSurfaceMessages {
  readonly surfaceId: string;
  readonly a2uiMessages: readonly unknown[];
}

/** Closed model choice. Facts and guest wording stay in the active pack. */
export type AssistantReplyPlanKind = "show_results" | "show_details" | "compare" | "explain_price" | "show_status" | "propose_action" | "clarify_stay" | "redirect";

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
  /** Words that signal the user is asking for this domain, used by the router. */
  readonly intentKeywords: readonly string[];
  readonly toolNames: readonly string[];
  /** Domain-owned consequential action names routed to this pack's platform command adapter. */
  readonly platformActionNames?: readonly string[];
  toolsForState(taskState: AssistantTaskState): readonly AssistantToolDefinition[];
  validateToolCall(name: string, args: Record<string, unknown>, taskState: AssistantTaskState): AssistantToolPreconditionFailure | undefined;
  executeTool(name: string, args: Record<string, unknown>, context: AssistantToolContext): AssistantToolExecutionResult;
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
  renderReply?(plan: AssistantReplyPlan | undefined, results: readonly import("./assistant-model.js").AssistantToolResult[], latestUserText: string): string;
  /** Re-reads authoritative truth before a proposed booking request is confirmed. */
  revalidateProposal(action: PendingAssistantAction): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string };
  /** Optional pack-owned command adapter; the pack must route through the platform ActionSpec gate. */
  handlePlatformAction?(input: { readonly actionName: string; readonly context: Record<string, unknown>; readonly principal: CommandPrincipal; readonly taskId: string; readonly activeSurfaceId?: string }): { readonly ok: true; readonly message: string; readonly surface?: AssistantTurnSurface } | { readonly ok: false; readonly code: string; readonly message: string };
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
