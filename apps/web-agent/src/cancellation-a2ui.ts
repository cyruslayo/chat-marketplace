import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import type { CancellationArtifact } from "../../web/src/cancellation-artifact.js";
import { CANCELLATION_CANCEL_EVENT, CANCELLATION_NO_SHOW_EVENT, cancellationActionContext } from "../../web/src/cancellation-actions.js";
export function cancellationArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: CancellationArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const f = artifact.facts; const r = f.currentRefundEstimate; const components: A2UIComponent[] = [
    { id: "cancellation-root", component: "Column", children: ["cancellation-title", "cancellation-policy", "cancellation-effect", "cancellation-components", "cancellation-status", ...(artifact.actions.length ? ["cancellation-action", "cancellation-action-label"] : [])] },
    { id: "cancellation-title", component: "Text", text: "Cancellation", variant: "h2" },
    { id: "cancellation-policy", component: "Text", text: `Captured policy: ${f.policy.type} (${f.policy.version}). Check-in timing: Africa/Lagos.` },
    { id: "cancellation-effect", component: "Text", text: `Current refund: ${r.refundPercentage}% of Cancellation Base; NGN ${(r.cancellationBaseRefundKobo / 100).toLocaleString("en-NG")} base refund; total NGN ${(r.totalRefundKobo / 100).toLocaleString("en-NG")}.` },
    { id: "cancellation-components", component: "Text", text: `Always refundable: cleaning NGN ${(r.cleaningFeeRefundKobo / 100).toLocaleString("en-NG")}, unprovided services NGN ${(r.unprovidedServicesRefundKobo / 100).toLocaleString("en-NG")}, deposit NGN ${(r.securityDepositRefundKobo / 100).toLocaleString("en-NG")}, tax and duplicate payment included. Refund returns to the original payment source.` },
    { id: "cancellation-status", component: "Text", text: f.case ? `Reservation ${f.reservationStatus}; refund status: ${f.case.refundStatus}.` : "No cancellation has been committed." }
  ];
  const action = artifact.actions[0]; if (action) { const noShow = action.type === "confirm_no_show"; const label = noShow ? "Confirm No-Show" : "Cancel booking"; components.push({ id: "cancellation-action", component: "Button", child: "cancellation-action-label", variant: "primary", action: { event: { name: noShow ? CANCELLATION_NO_SHOW_EVENT : CANCELLATION_CANCEL_EVENT, context: cancellationActionContext(action) } }, accessibility: { label } }, { id: "cancellation-action-label", component: "Text", text: label }); }
  return Object.freeze([{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }]);
}
