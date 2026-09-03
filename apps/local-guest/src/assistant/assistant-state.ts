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
  checkOut?: string;
  nights?: number;
  partySize?: number;
  maxBudgetKobo?: number;
  requiredAmenities?: readonly string[];
}

export interface AssistantTaskState {
  goal: "find_stay" | "book_stay" | "manage_booking" | null;
  stayIntent: AssistantStayIntent;
  shortlist: readonly AssistantStayReference[];
  selectedStayRef?: string;
  currentBookingRequestId?: string;
  currentOfferId?: string;
  currentReservationId?: string;
  currentContractId?: string;
  pendingAction?: PendingAssistantAction | null;
}

export interface AssistantThreadState {
  readonly threadId: string;
  readonly conversationHistory: AssistantConversationStep[];
  taskState: AssistantTaskState;
  activeSurfaces: Map<string, string>;
  supersededSurfaces: Set<string>;
  discoveryArtifactId: string | null;
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
  };
}

