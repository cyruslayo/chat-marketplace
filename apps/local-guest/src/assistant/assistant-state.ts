import type { PendingDraftReplacement } from "../draft-replacement.js";
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

/**
 * Issue 06 (ADR 0015): a budget is either an All-In Stay Total ("stay") or a nightly amount ("night") that is converted with the
 * stay's nights at search time, as the deterministic concierge does (`stayBudgetKobo`). The closed list is the only accepted meaning.
 */
export const ASSISTANT_BUDGET_PERS = ["stay", "night"] as const;
export type AssistantBudgetPer = (typeof ASSISTANT_BUDGET_PERS)[number];

export function isAssistantBudgetPer(value: unknown): value is AssistantBudgetPer {
  return value === "stay" || value === "night";
}

/** Issue 09 (ADR 0106): a different area the guest was asked about and has not answered; no search runs for it until answered. */
export interface AssistantPendingLocation {
  readonly city: string;
  readonly neighbourhood?: string;
}

/**
 * Issue 04 (ADR 0106, 2 Nov 2026): the candidate check-in dates of a relative phrase the guest has not confirmed. One candidate is a
 * show-back (the guest's yes confirms it); two or more are a choice (a tap on one candidate is the confirmation). Authorizes nothing.
 */
export interface AssistantPendingDate {
  readonly candidates: readonly string[];
  /**
   * Issue 05b (ADR 0106, 2 Nov 2026): set when the pending date is a checkout. The check-in it was shown with is guest-authored
   * (typed or confirmed), and the confirmed checkout is the candidate after it.
   */
  readonly checkIn?: string;
}

export interface AssistantStayIntent {
  location?: string;
  neighbourhood?: string;
  /** Issue 09: the area the held search would move to, while the conflict question is open. */
  pendingLocation?: AssistantPendingLocation;
  /** Issue 04: the dates a relative phrase gave, awaiting the guest's confirmation. Never a check-in until confirmed. */
  pendingDate?: AssistantPendingDate;
  checkIn?: string;
  isDemoDate?: boolean;
  checkOut?: string;
  nights?: number;
  partySize?: number;
  bedrooms?: number;
  /** The budget in kobo, with `maxBudgetPer` saying whether it is for the stay or per night (issue 06). */
  maxBudgetKobo?: number;
  maxBudgetPer?: AssistantBudgetPer;
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
  /** Issue 13a: the open replacement of the current Request Draft (ADR 0074, ADR 0080). Its surface id is re-keyed on a cold restore. */
  pendingDraftReplacement?: PendingDraftReplacement | null;
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
  /**
   * Issue 03d (ADR 0107 decision 11): this task's own model history. While the task is active, the thread's `conversationHistory`
   * is this same array. Never persisted; a cold restore starts it empty (owner decision O1).
   */
  conversationHistory: AssistantConversationStep[];
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
  /** The active task's model history (mirrors `tasks[activeTaskId].conversationHistory`; issue 03d). */
  conversationHistory: AssistantConversationStep[];
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
    // Issue 13a: the open draft and its replacement survive a clone (a restore clones the task state).
    currentDraftId: state.currentDraftId,
    currentBookingRequestId: state.currentBookingRequestId,
    currentOfferId: state.currentOfferId,
    currentReservationId: state.currentReservationId,
    currentContractId: state.currentContractId,
    pendingAction: state.pendingAction ? { ...state.pendingAction } : null,
    replacedPendingAction: state.replacedPendingAction ? { ...state.replacedPendingAction } : null,
    pendingDraftReplacement: state.pendingDraftReplacement ?? null,
  };
}
