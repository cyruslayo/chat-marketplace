import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import type { BookingContractArtifact } from "../../web/src/booking-contract-artifact.js";
import { bookingProgressText, formatBookingMoney, formatStayDates } from "./booking-presentation.js";

export function bookingContractArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: BookingContractArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const accessText = facts.accessAvailability === "available"
    ? "Access details are available in secure booking details. Reservation confirmation does not itself grant physical access."
    : "Access details will be released to secure booking details when the authorized check-in disclosure policy permits. Reservation confirmation does not itself grant physical access.";
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["booking-contract-title", "booking-contract-status", "booking-contract-unit", "booking-contract-stay", "booking-contract-party", "booking-contract-total", ...(facts.refundableSecurityDepositKobo && facts.refundableSecurityDepositKobo > 0 ? ["booking-contract-deposit"] : []), "booking-contract-paid", "booking-contract-progress", "booking-contract-arrival", "booking-contract-checkout", "booking-contract-policies", "booking-contract-references"] },
    { id: "booking-contract-title", component: "Text", text: "Booking confirmed", variant: "h2" },
    { id: "booking-contract-status", component: "Text", text: "Reservation and Booking Contract are confirmed" },
    { id: "booking-contract-unit", component: "Text", text: facts.unitTitle ?? "Your confirmed stay", variant: "h3" },
    { id: "booking-contract-stay", component: "Text", text: `Stay: ${formatStayDates(facts.checkIn, facts.checkOut)} (${facts.nights} nights)` },
    { id: "booking-contract-party", component: "Text", text: `${facts.occupants.length} ${facts.occupants.length === 1 ? "guest" : "guests"} · Primary Guest: ${facts.primaryGuest.name}` },
    ...(facts.allInStayTotalKobo === undefined ? [] : [{ id: "booking-contract-total", component: "Text" as const, text: `All-In Stay Total: ${formatBookingMoney(facts.allInStayTotalKobo)}`, variant: "h3" as const }]),
    ...(facts.refundableSecurityDepositKobo === undefined || facts.refundableSecurityDepositKobo <= 0 ? [] : [{ id: "booking-contract-deposit", component: "Text" as const, text: `Refundable Security Deposit (separate): ${formatBookingMoney(facts.refundableSecurityDepositKobo)}` }]),
    { id: "booking-contract-paid", component: "Text", text: `Payment verified: ${formatBookingMoney(facts.amountPaidKobo)}` },
    { id: "booking-contract-progress", component: "Text", text: bookingProgressText("confirmed") },
    { id: "booking-contract-arrival", component: "Text", text: accessText },
    { id: "booking-contract-checkout", component: "Text", text: `Checkout time: ${facts.checkout?.time ?? "11:00"} WAT` },
    { id: "booking-contract-policies", component: "Text", text: `Cancellation terms: ${facts.cancellationPolicy?.summary ?? "captured in your Booking Contract"}; Guest conduct: ${facts.guestConductRules.join("; ") || "captured in your Booking Contract"}` },
    { id: "booking-contract-references", component: "Text", text: `Booking references: Reservation ${facts.reservationId} · Contract version ${facts.contractVersion}${facts.cardMetadata ? ` · Card ending ${facts.cardMetadata.last4}` : ""}` },
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
