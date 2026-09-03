import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import type { BookingContractArtifact } from "../../web/src/booking-contract-artifact.js";

function amount(kobo: number | undefined, currency = "NGN"): string { return kobo === undefined ? "Not captured" : `${currency} ${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`; }

export function bookingContractArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: BookingContractArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["booking-contract-title", "booking-contract-parties", "booking-contract-stay", "booking-contract-money", "booking-contract-payment", "booking-contract-policies", "booking-contract-arrival", "booking-contract-version", "booking-contract-checkout"] },
    { id: "booking-contract-title", component: "Text", text: "Booking confirmed", variant: "h2" },
    { id: "booking-contract-parties", component: "Text", text: `Primary Guest: ${facts.primaryGuest.name}; Accommodation Provider: ${facts.accommodationProvider.name ?? facts.accommodationProvider.id}` },
    { id: "booking-contract-stay", component: "Text", text: `Unit: ${facts.unitId}; Stay: ${facts.checkIn} to ${facts.checkOut} (${facts.nights} nights)` },
    { id: "booking-contract-money", component: "Text", text: `All-In Stay Total: ${amount(facts.allInStayTotalKobo, facts.currency)}; Refundable Security Deposit: ${amount(facts.refundableSecurityDepositKobo, facts.currency)}${facts.securityDeposit ? ` (${facts.securityDeposit.policyVersion}, ${facts.securityDeposit.status})` : ""}; Paid: ${amount(facts.amountPaidKobo, facts.currency)}` },
    { id: "booking-contract-payment", component: "Text", text: `Payment method: ${facts.paymentMethod}${facts.cardMetadata ? ` (${facts.cardMetadata.brand} ending ${facts.cardMetadata.last4})` : ""}` },
    { id: "booking-contract-policies", component: "Text", text: `Policies: ${facts.cancellationPolicy?.summary ?? "not available"}; Guest conduct: ${facts.guestConductRules.join("; ") || "not available"}; Disclosures: ${artifact.disclosures.join("; ") || "not available"}` },
    { id: "booking-contract-arrival", component: "Text", text: `Full address: ${facts.addressAvailability === "available" ? "available in secure booking details" : "not available"}; Access instructions: ${facts.accessAvailability === "available" ? "available in secure booking details" : "will be released when the authorized disclosure policy permits."}` },
    { id: "booking-contract-version", component: "Text", text: `Contract version: ${facts.contractVersion}` }, { id: "booking-contract-checkout", component: "Text", text: `Checkout: ${facts.checkout?.time ?? "11:00"} WAT` },
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
