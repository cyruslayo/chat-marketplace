/**
 * The Agent Mark state map (ADR 0107 decision 9, issue 01b). A pure function from the current state and one shell signal to the next
 * state. The client feeds it only signals the shell already has (the turn in flight, the reply, the refusal, the composer), so the state
 * is derived from the current request and never persisted (ADR 0106: a cold restore starts again from `idle`).
 *
 * Only `idle`, `listening`, `thinking`, `responding` and `resting` are produced in this slice. `working` maps to `thinking` because no
 * tool-step signal exists today. `suggesting` and `switching` wait for the mode strip (slice 4b).
 *
 * ADR 0076 (human takeover): no takeover signal reaches the guest app today, so `human` is never produced. Any future takeover signal on
 * guest responses must set `human` and block `thinking`, `working` and `responding`. This map keeps `human` absorbing, so no later event
 * can show AI activity over a human-owned conversation.
 */

export const AGENT_MARK_STATES = ["idle", "listening", "thinking", "working", "responding", "suggesting", "switching", "resting", "human"] as const;

export type AgentMarkState = (typeof AGENT_MARK_STATES)[number];

export type AgentMarkPlacement = "hero" | "appbar" | "dock";

export type AgentMarkRefusalCode = "quota_refusal" | "CONCIERGE_UNAVAILABLE";

export type AgentMarkEvent =
  | { readonly type: "turn-started" }
  | { readonly type: "reply-landed" }
  | { readonly type: "response-settled" }
  | { readonly type: "turn-refused"; readonly code: AgentMarkRefusalCode }
  | { readonly type: "composer-changed"; readonly focusedWithText: boolean };

/** States in which the concierge is busy with the guest's turn; typing does not interrupt them. */
const BUSY_STATES: readonly AgentMarkState[] = ["thinking", "working", "responding"];

export function nextAgentMarkState(current: AgentMarkState, event: AgentMarkEvent): AgentMarkState {
  // ADR 0076: a human-owned conversation never shows AI activity. No event leaves `human` in this slice.
  if (current === "human") return "human";
  switch (event.type) {
    case "turn-started":
      return "thinking";
    case "reply-landed":
      return "responding";
    case "response-settled":
      return current === "responding" ? "idle" : current;
    case "turn-refused":
      return "resting";
    case "composer-changed":
      if (event.focusedWithText) return BUSY_STATES.includes(current) ? current : "listening";
      return current === "listening" ? "idle" : current;
  }
}
