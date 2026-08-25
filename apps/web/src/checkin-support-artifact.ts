import { createHash } from "node:crypto";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { CheckInSupportManager, ComplaintCategory } from "../../../domains/shortlet/src/checkin-support.js";

export const CHECK_IN_SUPPORT_ARTIFACT_KIND = "shortlet.check-in-support";
export const CHECK_IN_SUPPORT_SCHEMA_VERSION = "shortlet.check-in-support/v1";
export type CheckInGuestAction = "confirm_access" | "request_human_support" | "report_access_problem";
export interface CheckInSupportArtifact {
  readonly id: string; readonly kind: typeof CHECK_IN_SUPPORT_ARTIFACT_KIND; readonly schemaVersion: typeof CHECK_IN_SUPPORT_SCHEMA_VERSION; readonly projectionVersion: string;
  readonly facts: { readonly reservationId: string; readonly contractId: string; readonly unitId: string; readonly checkInDate: string; readonly earliestAccessTime: string; readonly latestPermittedArrival: string; readonly timezone: "Africa/Lagos"; readonly supportStatus: string; readonly humanSupportAvailable: boolean; readonly accessStatus: string; readonly verifiedAt?: string; readonly protectionWindowStartsAt?: string; readonly hasBlockingComplaint: boolean; readonly complaintCategory?: ComplaintCategory; readonly complaintStatus?: string; readonly revenueHeld: boolean };
  readonly actions: readonly { readonly type: CheckInGuestAction; readonly artifactId: string; readonly reservationId: string; readonly expectedStatus: string; readonly projectionVersion: string; readonly complaintCategory?: ComplaintCategory }[];
  readonly sensitivity: "booking-sensitive";
}
export function checkInSupportArtifactId(reservationId: string): string { return `check-in-support:${reservationId}`; }
export function checkInSupportArtifactFromStatus(input: { status: ReturnType<CheckInSupportManager["projectCheckInStatus"]>; contractId: string; unitId: string; viewer: CommandPrincipal }): CheckInSupportArtifact {
  const { status, contractId, unitId, viewer } = input; const complaint = status.activeComplaints.find((item) => item.status !== "resolved");
  const markers = [status.reservationId, contractId, unitId, status.checkInWindow.checkInDate, status.checkInWindow.earliestAccessTime, status.checkInWindow.latestPermittedArrival, status.supportOwnership.status, status.accessResult.status, status.accessResult.protectionWindowStartsAt ?? "", complaint?.status ?? "", complaint?.category ?? "", String(status.revenueHeld)];
  const projectionVersion = createHash("sha256").update(markers.join("|")).digest("hex").slice(0, 16);
  const authorized = viewer.role === "guest";
  const active = status.supportOwnership.status === "handoff_requested" || status.supportOwnership.status === "human_owned";
  const terminal = status.accessResult.status === "verified_access" || status.accessResult.status === "late_voluntary_arrival" || status.accessResult.status === "failed_access" || status.accessResult.status === "under_human_review";
  const actions = authorized && !active && !terminal && !complaint ? [
    { type: "confirm_access" as const, artifactId: checkInSupportArtifactId(status.reservationId), reservationId: status.reservationId, expectedStatus: status.accessResult.status, projectionVersion },
    { type: "request_human_support" as const, artifactId: checkInSupportArtifactId(status.reservationId), reservationId: status.reservationId, expectedStatus: status.accessResult.status, projectionVersion },
    { type: "report_access_problem" as const, artifactId: checkInSupportArtifactId(status.reservationId), reservationId: status.reservationId, expectedStatus: status.accessResult.status, projectionVersion },
  ] : [];
  return Object.freeze({ id: checkInSupportArtifactId(status.reservationId), kind: CHECK_IN_SUPPORT_ARTIFACT_KIND, schemaVersion: CHECK_IN_SUPPORT_SCHEMA_VERSION, projectionVersion, facts: Object.freeze({ reservationId: status.reservationId, contractId, unitId, checkInDate: status.checkInWindow.checkInDate, earliestAccessTime: status.checkInWindow.earliestAccessTime, latestPermittedArrival: status.checkInWindow.latestPermittedArrival, timezone: status.checkInWindow.timezone, supportStatus: active ? (status.supportOwnership.status === "human_owned" ? "human_owned" : "handoff_requested") : status.supportOwnership.status, humanSupportAvailable: Boolean(status.supportOwnership.assignedResponderId && status.supportOwnership.backupResponderId), accessStatus: status.accessResult.status, ...(status.accessResult.verifiedAt ? { verifiedAt: status.accessResult.verifiedAt } : {}), ...(status.accessResult.protectionWindowStartsAt ? { protectionWindowStartsAt: status.accessResult.protectionWindowStartsAt } : {}), hasBlockingComplaint: Boolean(complaint), ...(complaint ? { complaintCategory: complaint.category, complaintStatus: complaint.status } : {}), revenueHeld: status.revenueHeld }), actions: Object.freeze(actions), sensitivity: "booking-sensitive" });
}
