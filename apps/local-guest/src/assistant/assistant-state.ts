import type { PendingAssistantAction } from "./pending-actions.js";
import type { AssistantConversationStep } from "./assistant-model.js";

/**
 * Server-owned assistant task and conversational state (ADR-0004 / ADR-0070).
 *
 * This is assistant working state, NOT domain truth. Authoritative domain
 * entities are never placed directly into this state.
 */

export interface AssistantStayReference {
  readonly stayRef: string; // e.g. "stay-1"
  readonly unitId: string;
  readonly title: string;
  readonly city: string;
  readonly neighbourhood: string;
  readonly capacity: number;
  readonly bedrooms?: number;
  readonly amenities: readonly string[];
  readonly nightlyKobo: number;
  readonly allInStayTotalKobo: number | null;
  readonly mandatoryFeesKobo: number;
  readonly refundableSecurityDepositKobo: number;
  readonly amountDueNowKobo: number | null;
  readonly inspectionStatus: string;
  readonly managementAuthorityStatus: string;
}

export interface AssistantStayIntent {
  location?: string;
  neighbourhood?: string;
  checkIn?: string;
  isDemoDate?: boolean;
  checkOut?: string;
  nights?: number;
  partySize?: number;
  bedrooms?: number;
  maxBudgetKobo?: number;
  requiredAmenities?: readonly string[];
}

export interface AssistantTaskState {
  goal: "find_stay" | "book_stay" | "manage_booking" | null;
  stayIntent: AssistantStayIntent;
  shortlist: readonly AssistantStayReference[];
  selectedStayRef?: string;
  currentDraftId?: string;
  currentBookingRequestId?: string;
  currentOfferId?: string;
  currentReservationId?: string;
  currentContractId?: string;
  pendingAction?: PendingAssistantAction | null;
  /**
   * ADR 0074 (owner decision, 28 Oct 2026): the proposal the last search change or task switch removed. Its id only; no
   * authority. The next explicit confirmation is answered with a fixed reply instead of a model call, then the marker clears.
   */
  replacedPendingAction?: ReplacedPendingAction | null;
}

export type PendingReplacementReason = "search_changed" | "task_switched";

export interface ReplacedPendingAction {
  readonly id: string;
  readonly reason: PendingReplacementReason;
}

/**
 * Removes a proposal's authority and keeps only a notice of it (ADR 0074). Returns false when there is no open proposal.
 * Mutates the state it is given; callers pass the candidate state they commit.
 */
export function replacePendingProposal(state: AssistantTaskState, reason: PendingReplacementReason): boolean {
  const pending = state.pendingAction;
  if (!pending || pending.executed) return false;
  state.replacedPendingAction = { id: pending.id, reason };
  state.pendingAction = null;
  return true;
}

/** One rendered surface a task currently owns (presentation only; authoritative state lives in the domain). */
export interface AssistantTurnSurface {
  readonly surfaceId: string;
  readonly a2uiMessages: readonly unknown[];
}

/** One conversation task: a flow in one domain. A thread may hold several, with one active. */
export interface AssistantTask {
  readonly taskId: string;
  readonly domain: string;
  state: AssistantTaskState;
  /** The task's own workspace, saved when it is deactivated and restored when it is re-opened. */
  activeSurfaces: Map<string, string>;
  supersededSurfaces: Set<string>;
  lastSurfaces: readonly AssistantTurnSurface[];
  /** Unread async events for this task, shown as a rail badge and cleared when the task is opened. */
  badge: number;
}

export interface AssistantThreadState {
  readonly threadId: string;
  readonly guestActorId: string;
  readonly tenantId: string;
  readonly conversationHistory: AssistantConversationStep[];
  tasks: AssistantTask[];
  activeTaskId: string;
  /** The active task's state (mirrors `tasks[activeTaskId].state`). */
  taskState: AssistantTaskState;
  /** The active task's live workspace (mirrors the active task's fields). */
  activeSurfaces: Map<string, string>;
  supersededSurfaces: Set<string>;
  lastSurfaces: readonly AssistantTurnSurface[];
  discoveryArtifactId: string | null;
  /** Current server-owned discovery artifact for same-turn adapter synchronization only. */
  discoveryArtifact?: unknown;
  /** Redacted canonical slots used for date provenance after a trusted cold-start restore. */
  canonicalUserFactHistory?: readonly string[];
}

export function createInitialTaskState(): AssistantTaskState {
  return {
    goal: null,
    stayIntent: {},
    shortlist: [],
    selectedStayRef: undefined,
    currentBookingRequestId: undefined,
    currentOfferId: undefined,
    currentReservationId: undefined,
    currentContractId: undefined,
    pendingAction: null,
  };
}

export function cloneTaskState(state: AssistantTaskState): AssistantTaskState {
  return {
    goal: state.goal,
    stayIntent: {
      ...state.stayIntent,
      requiredAmenities: state.stayIntent.requiredAmenities ? [...state.stayIntent.requiredAmenities] : undefined,
    },
    shortlist: state.shortlist.map((item) => ({ ...item, amenities: [...item.amenities] })),
    selectedStayRef: state.selectedStayRef,
    currentBookingRequestId: state.currentBookingRequestId,
    currentOfferId: state.currentOfferId,
    currentReservationId: state.currentReservationId,
    currentContractId: state.currentContractId,
    pendingAction: state.pendingAction ? { ...state.pendingAction } : null,
    replacedPendingAction: state.replacedPendingAction ? { ...state.replacedPendingAction } : null,
  };
}
