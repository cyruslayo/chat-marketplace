import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import { PAYMENT_CAPABILITY_INITIALIZE_USSD_EVENT } from "../../web/src/payment-capability-actions.js";
import type { PaymentCapabilityArtifact } from "../../web/src/payment-capability-artifact.js";
export function paymentCapabilityArtifactToA2UI({ artifact, surfaceId }: { artifact: PaymentCapabilityArtifact; surfaceId: string }): readonly A2UIServerMessage[] {
  const methods = artifact.facts.availableMethods.join(", ") || "none"; const ussd = artifact.facts.ussd; const action = artifact.actions[0];
  const components: A2UIComponent[] = [
    { id: "payment-capability-root", component: "Column", children: ["payment-capability-title", "payment-capability-methods", "payment-capability-deadline", "payment-capability-status", "payment-capability-actions"] },
    { id: "payment-capability-title", component: "Text", text: "Payment methods", variant: "h2" },
    { id: "payment-capability-methods", component: "Text", text: `Available: ${methods}` },
    { id: "payment-capability-deadline", component: "Text", text: `Payment deadline: ${artifact.facts.paymentDeadline}` },
    { id: "payment-capability-status", component: "Text", text: ussd ? `USSD instructions: ${ussd.code}; expires ${ussd.expiresAt}. Payment is not yet confirmed.` : artifact.facts.livePaymentMethod ? `Live payment method: ${artifact.facts.livePaymentMethod}. Payment is not yet confirmed.` : "Choose an available payment method." },
    { id: "payment-capability-actions", component: "Row", children: action ? ["payment-capability-ussd"] : [] },
    ...(action ? [{ id: "payment-capability-ussd", component: "Button" as const, child: "payment-capability-ussd-label", variant: "primary" as const, action: { event: { name: PAYMENT_CAPABILITY_INITIALIZE_USSD_EVENT, context: { artifactId: artifact.id, offerId: artifact.facts.offerId, capabilityId: action.capabilityId, expectedStatus: action.expectedStatus, projectionVersion: artifact.projectionVersion } } }, accessibility: { label: "Initialize USSD payment" } }, { id: "payment-capability-ussd-label", component: "Text" as const, text: "Use USSD" }] : [])
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
