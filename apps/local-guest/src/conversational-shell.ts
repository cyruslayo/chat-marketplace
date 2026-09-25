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

export function formatGuestHistorySummary(summary: string, status: HistoricalSurfaceSummary["status"]): string {
  if (status === "expired") return /offer/i.test(summary) ? "Offer expired" : "Booking details expired";
  if (status === "deleted") return "Details no longer available";

  const search = /^Search updated\s*·\s*(.*)$/.exec(summary);
  const activity = search ? `Searched ${search[1]}`
    : /^(Discovery results|All discovery results)$/.test(summary) ? "Viewed stays for your search"
      : summary.endsWith(" details") ? `Viewed ${summary.slice(0, -" details".length)}`
        : summary === "Request Draft" ? "Draft created"
          : summary === "Request review" ? "Booking details reviewed"
            : summary === "Request outcome" ? "Booking request update"
              : summary.includes("Conditional Booking Offer") ? "Booking offer received"
                : summary === "Payment handoff" ? "Opened hosted checkout"
                  : summary === "Reservation confirmed" ? "Stay confirmed"
                    : /workspace|booking/i.test(summary) ? "Booking details updated"
                      : summary;

  if (status === "stale") return `${activity} · details may have changed`;
  if (status === "fallback") return `${activity} · details unavailable`;
  return activity;
}

export function guestSurfaceHeading(summary: string): string {
  if (/search|discovery/i.test(summary)) return "Stays for your search";
  if (/details$/i.test(summary) || /unit/i.test(summary)) return "Stay details";
  if (/draft|request review/i.test(summary)) return "Your booking details";
  if (/offer/i.test(summary)) return "Booking offer";
  if (/payment|checkout/i.test(summary)) return "Hosted checkout";
  if (/confirm|reservation/i.test(summary)) return "Booking confirmed";
  if (/phone|email|contact/i.test(summary)) return "Your contact details";
  return "Booking details";
}

export function guestSurfaceStatusMessage(status: SurfaceLifecycleStatus): string {
  if (status === "active") return "";
  if (status === "superseded") return "Earlier details · no longer current";
  if (status === "stale") return "These details may have changed. Check the latest version before continuing.";
  if (status === "expired") return "These booking details have expired. Check the latest status before continuing.";
  if (status === "deleted") return "These details are no longer available.";
  return "Some details could not be shown. Continue in the conversation for help.";
}

export function fallbackSummary(surface: SurfacePresentation): string {
  if (surface.status === "fallback") return surface.textFallback ?? surface.summary;
  return guestSurfaceStatusMessage(surface.status) || surface.summary;
}
