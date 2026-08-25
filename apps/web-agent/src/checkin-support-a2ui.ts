import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import type { CheckInSupportArtifact } from "../../web/src/checkin-support-artifact.js";
import { CHECK_IN_CONFIRM_ACCESS_EVENT, CHECK_IN_REPORT_PROBLEM_EVENT, CHECK_IN_REQUEST_SUPPORT_EVENT } from "../../web/src/checkin-support-actions.js";
export function checkInSupportArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: CheckInSupportArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact; const children = ["checkin-title", "checkin-window", "checkin-support", "checkin-access", "checkin-complaint"];
  const components: A2UIComponent[] = [
    { id: "checkin-root", component: "Column", children },
    { id: "checkin-title", component: "Text", text: "Arrival / Check-In", variant: "h2" },
    { id: "checkin-window", component: "Text", text: `Arrival window: ${facts.checkInDate}, ${facts.earliestAccessTime}–${facts.latestPermittedArrival} WAT (${facts.timezone})` },
    { id: "checkin-support", component: "Text", text: facts.humanSupportAvailable ? `Human Incident Support: ${facts.supportStatus}` : "Human Incident Support is not available" },
    { id: "checkin-access", component: "Text", text: facts.accessStatus === "verified_access" ? `Verified Access established. Protection starts at ${facts.protectionWindowStartsAt}` : facts.accessStatus === "late_voluntary_arrival" ? `Late voluntary arrival confirmed. Protection starts at ${facts.protectionWindowStartsAt}` : facts.accessStatus === "failed_access" ? "Failed access: Human Support is handling this issue." : facts.accessStatus === "under_human_review" ? "Access evidence is under Human Support review." : "Access confirmation is awaiting arrival." },
    { id: "checkin-complaint", component: "Text", text: facts.hasBlockingComplaint ? `Blocking complaint: ${facts.complaintCategory}; relevant revenue remains held.` : "No blocking complaint is open." },
    ...artifact.actions.flatMap((action): A2UIComponent[] => { const event = action.type === "confirm_access" ? CHECK_IN_CONFIRM_ACCESS_EVENT : action.type === "request_human_support" ? CHECK_IN_REQUEST_SUPPORT_EVENT : CHECK_IN_REPORT_PROBLEM_EVENT; const label = action.type === "confirm_access" ? "Confirm access" : action.type === "request_human_support" ? "Request Human Support" : "Report an access problem"; return [{ id: `checkin-${action.type}`, component: "Button", child: `checkin-${action.type}-label`, variant: "primary", action: { event: { name: event, context: { artifactId: action.artifactId, reservationId: action.reservationId, expectedStatus: action.expectedStatus, projectionVersion: action.projectionVersion } } }, accessibility: { label } }, { id: `checkin-${action.type}-label`, component: "Text", text: label }]; }),
  ];
  return Object.freeze([{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }]);
}
export { checkInSupportArtifactToA2UI as checkinSupportArtifactToA2UI };
