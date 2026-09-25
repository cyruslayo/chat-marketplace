import { GUEST_JOURNEY } from "../../web-agent/src/guest-content.js";

/**
 * Issue 08: the guest journey rail, derived from the server's workflow
 * projection (ADR-0005). Presentation only; it never owns booking state.
 */
export const JOURNEY_STEPS = ["search", "stay", "request", "offer", "pay", "confirmed"] as const;
export type JourneyStep = typeof JOURNEY_STEPS[number];
export type JourneyStepState = "done" | "current" | "failed" | "upcoming";
export type JourneyOutcomeKind = "declined" | "expired" | "not-delivered" | "closed" | "failed";

export interface JourneyOutcome {
  readonly kind: JourneyOutcomeKind;
  readonly label: string;
}

export interface GuestJourney {
  readonly current: JourneyStep;
  readonly outcome?: JourneyOutcome;
  readonly steps: readonly { readonly id: JourneyStep; readonly label: string; readonly state: JourneyStepState }[];
}

/**
 * Steps before the current one are done. A failed or expired outcome is shown
 * on its own step as "failed", never as progress, and nothing after it
 * advances (issue 08 AC2).
 */
export function projectJourney(current: JourneyStep, outcome?: JourneyOutcome): GuestJourney {
  const index = JOURNEY_STEPS.indexOf(current);
  return {
    current,
    ...(outcome === undefined ? {} : { outcome: { kind: outcome.kind, label: outcome.label } }),
    steps: JOURNEY_STEPS.map((id, position) => ({
      id,
      label: position === index && outcome !== undefined ? outcome.label : GUEST_JOURNEY[id],
      state: position < index ? "done" : position > index ? "upcoming" : outcome === undefined ? "current" : "failed",
    })),
  };
}
