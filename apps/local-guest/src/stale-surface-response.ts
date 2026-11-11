import { GUEST_CHANGED_ELSEWHERE } from "../../web-agent/src/guest-content.js";

/**
 * Issue 11 (ADR 0072, 0074, 0106; guideline §6, §9): the client-side recovery for a refused action whose surface or
 * artifact is no longer current. The server remains the authority; this only chooses the view and the guest wording.
 */
export interface ChangedElsewhereRecovery {
  /** `stale` marks the surface out of date; `expired` marks it ended. Both are read-only until the state refreshes. */
  readonly kind: "stale" | "expired";
  /** The guest sentence to show instead of the server's internal rejection message, when it differs. */
  readonly message?: string;
}

export function changedElsewhereRecovery(code: string | undefined): ChangedElsewhereRecovery | undefined {
  if (code === "EXPIRED_SURFACE") return { kind: "expired" };
  if (code === "STALE_SURFACE" || code === "STALE_ACTION") return { kind: "stale" };
  // A forged or superseded artifact id is the same guest situation: the view no longer matches the authoritative record.
  if (code === "ARTIFACT_MISMATCH") return { kind: "stale", message: GUEST_CHANGED_ELSEWHERE.message };
  return undefined;
}
