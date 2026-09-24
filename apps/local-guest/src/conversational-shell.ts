export type PresentationMode = "text" | "inline-surface" | "focused-surface";

export type SurfaceLifecycleStatus =
  | "active"
  | "superseded"
  | "stale"
  | "expired"
  | "deleted"
  | "fallback";

export interface SurfacePresentation {
  readonly surfaceId: string;
  readonly mode: PresentationMode;
  readonly status: SurfaceLifecycleStatus;
  readonly summary: string;
  readonly textFallback?: string;
  readonly conventionalRoute?: string;
  readonly conventionalRouteLabel?: string;
}

export interface HistoricalSurfaceSummary {
  readonly surfaceId: string;
  readonly status: "superseded" | "stale" | "expired" | "deleted" | "fallback";
  readonly summary: string;
}

export interface ConversationShellState {
  readonly activeSurface?: SurfacePresentation;
  readonly historicalSummaries: readonly HistoricalSurfaceSummary[];
  readonly focusedSurfaceOpen: boolean;
}

export function createConversationShellState(): ConversationShellState {
  return { historicalSummaries: [], focusedSurfaceOpen: false };
}

export function replaceActiveSurface(
  state: ConversationShellState,
  next: SurfacePresentation,
): ConversationShellState {
  const current = state.activeSurface;
  const shouldRecordCurrent = current !== undefined && current.surfaceId !== next.surfaceId;
  const historicalSummary = shouldRecordCurrent
    ? {
        surfaceId: current.surfaceId,
        status: "superseded" as const,
        summary: current.summary,
      }
    : undefined;

  return {
    activeSurface: next,
    historicalSummaries: historicalSummary === undefined
      ? state.historicalSummaries
      : [...state.historicalSummaries, historicalSummary],
    focusedSurfaceOpen: next.mode === "focused-surface" && next.status === "active",
  };
}

export function closeFocusedSurface(state: ConversationShellState): ConversationShellState {
  if (state.activeSurface?.mode !== "focused-surface") return state;
  return { ...state, focusedSurfaceOpen: false };
}

export function reopenFocusedSurface(state: ConversationShellState): ConversationShellState {
  if (state.activeSurface?.mode !== "focused-surface" || state.activeSurface.status !== "active") return state;
  return { ...state, focusedSurfaceOpen: true };
}

export function markActiveSurfaceStatus(
  state: ConversationShellState,
  status: Exclude<SurfaceLifecycleStatus, "active">,
): ConversationShellState {
  if (!state.activeSurface) return state;
  return {
    ...state,
    activeSurface: { ...state.activeSurface, status },
    focusedSurfaceOpen: false,
  };
}

export function canUseSurfaceActions(status: SurfaceLifecycleStatus): boolean {
  return status === "active";
}

export function fallbackSummary(surface: SurfacePresentation): string {
  if (surface.status === "fallback") return surface.summary;
  if (surface.status === "stale") return "This workspace is out of date. Refresh to continue.";
  if (surface.status === "expired") return "This workspace has expired. Refresh to continue.";
  if (surface.status === "deleted") return "This workspace is no longer available.";
  if (surface.status === "superseded") return "This workspace has been replaced by a newer one.";
  return surface.summary;
}
