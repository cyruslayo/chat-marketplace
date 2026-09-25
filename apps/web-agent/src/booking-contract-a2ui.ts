import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import type { BookingContractArtifact } from "../../web/src/booking-contract-artifact.js";
import { formatBookingMoney, formatStayDates } from "./booking-presentation.js";

export function bookingContractArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: BookingContractArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const accessText = facts.accessAvailability === "available"
    ? "Your access details are in secure booking details."
    : "Check-in details will be shared when they are ready. A confirmed booking does not itself grant physical access.";
  const meaningfulOccupants = facts.occupants.filter((name) => !/^(?:demo\s+guest|guest(?:\s*\d+)?|companion\s+\d+)$/i.test(name.trim()));
  const partySummary = meaningfulOccupants.length > 0
    ? `${facts.occupants.length} ${facts.occupants.length === 1 ? "guest" : "guests"}: ${meaningfulOccupants.join(", ")}`
    : `${facts.occupants.length} ${facts.occupants.length === 1 ? "guest" : "guests"}`;
  // ADR-0015/0016/0085: only call the refundable deposit collected when the
  // contract projection confirms the collection is held.
  const depositCollected = facts.securityDeposit?.status === "held" && (facts.refundableSecurityDepositKobo ?? 0) > 0;
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["booking-contract-title", "booking-contract-status", "booking-contract-unit", "booking-contract-stay", "booking-contract-party", "booking-contract-paid", ...(depositCollected ? ["booking-contract-deposit"] : []), "booking-contract-arrival", "booking-contract-checkout", "booking-contract-policies", "booking-contract-references"] },
    { id: "booking-contract-title", component: "Text", text: "Booking confirmed", variant: "h2" },
    { id: "booking-contract-status", component: "Text", text: "Reservation confirmed" },
    { id: "booking-contract-unit", component: "Text", text: facts.unitTitle ?? "Your confirmed stay", variant: "h3" },
    { id: "booking-contract-stay", component: "Text", text: `${formatStayDates(facts.checkIn, facts.checkOut)} · ${facts.nights} ${facts.nights === 1 ? "night" : "nights"}` },
    { id: "booking-contract-party", component: "Text", text: partySummary },
    { id: "booking-contract-paid", component: "Text", text: `Stay payment verified: ${formatBookingMoney(facts.amountPaidKobo)}` },
    ...(depositCollected ? [{ id: "booking-contract-deposit", component: "Text" as const, text: `Refundable deposit collected: ${formatBookingMoney(facts.refundableSecurityDepositKobo!)}` }] : []),
    { id: "booking-contract-arrival", component: "Text", text: accessText },
    { id: "booking-contract-checkout", component: "Text", text: `Checkout time: ${facts.checkout?.time ?? "11:00"} WAT` },
    { id: "booking-contract-policies", component: "Text", text: `Cancellation terms: ${facts.cancellationPolicy?.summary ?? "See your Booking Contract."} House rules: ${facts.guestConductRules.join("; ") || "See your Booking Contract."}` },
    { id: "booking-contract-references", component: "Text", text: `Booking reference and full contract are in your booking details.${facts.cardMetadata ? ` Card ending ${facts.cardMetadata.last4}.` : ""}` },
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
