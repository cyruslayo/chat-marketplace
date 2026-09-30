import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@weaver/core";
import type { BookingContractArtifact } from "../../web/src/booking-contract-artifact.js";
import { confirmationSteps } from "./confirmation-presentation.js";
import { formatBookingMoney, ticketFactComponents, ticketFactIds } from "./booking-presentation.js";
import { GUEST_FACT_LABELS, GUEST_GLOSSARY, accommodationProviderLine, guestFact, guestReservationStatus } from "./guest-content.js";

export function bookingContractArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: BookingContractArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const { facts } = artifact;
  const accessText = confirmationSteps(facts).slice(0, -1).join(" ");
  const guestNames = facts.occupants.filter((name) => !/^(?:demo\s+guest|guest(?:\s*\d+)?|companion\s+\d+)$/i.test(name.trim()));
  // ADR-0015/0016/0085: only call the refundable deposit collected when the
  // contract projection confirms the collection is held.
  const depositCollected = facts.securityDeposit?.status === "held" && (facts.refundableSecurityDepositKobo ?? 0) > 0;
  const components: A2UIComponent[] = [
    { id: "root", component: "Column", children: ["booking-contract-title", "booking-contract-status", "booking-contract-unit", "booking-contract-provider", ...ticketFactIds("booking-contract"), ...(guestNames.length > 0 ? ["booking-contract-guests"] : []), ...(facts.allInStayTotalKobo === undefined ? [] : ["booking-contract-total"]), ...((facts.refundableSecurityDepositKobo ?? 0) > 0 ? ["booking-contract-deposit"] : []), "booking-contract-paid", ...(depositCollected ? ["booking-contract-deposit-collected"] : []), "booking-contract-arrival", "booking-contract-checkout", "booking-contract-policies", "booking-contract-references"] },
    { id: "booking-contract-title", component: "Text", text: "Your booking", variant: "h2" },
    { id: "booking-contract-status", component: "Text", text: guestReservationStatus("confirmed") },
    { id: "booking-contract-unit", component: "Text", text: facts.unitTitle ?? "Your stay", variant: "h3" },
    // ADR-0006: the Booking Contract is with this Operator as accommodation provider.
    { id: "booking-contract-provider", component: "Text", text: accommodationProviderLine(facts.accommodationProvider.name) },
    ...ticketFactComponents("booking-contract", { checkIn: facts.checkIn, checkOut: facts.checkOut, nights: facts.nights, guestCount: facts.occupants.length }),
    ...(guestNames.length > 0 ? [{ id: "booking-contract-guests", component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.guests, guestNames.join(", ")) }] : []),
    ...(facts.allInStayTotalKobo === undefined ? [] : [{ id: "booking-contract-total", component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.allInStayTotal, formatBookingMoney(facts.allInStayTotalKobo)), variant: "h3" as const }]),
    ...((facts.refundableSecurityDepositKobo ?? 0) > 0 ? [{ id: "booking-contract-deposit", component: "Text" as const, text: guestFact(GUEST_FACT_LABELS.refundableSecurityDeposit, formatBookingMoney(facts.refundableSecurityDepositKobo!)) }] : []),
    { id: "booking-contract-paid", component: "Text", text: guestFact(GUEST_FACT_LABELS.amountPaid, formatBookingMoney(facts.amountPaidKobo)) },
    // ADR-0015/0016/0085: collected only when the contract projection confirms the deposit is held.
    ...(depositCollected ? [{ id: "booking-contract-deposit-collected", component: "Text" as const, text: `${GUEST_GLOSSARY.refundableSecurityDeposit} collected: ${formatBookingMoney(facts.refundableSecurityDepositKobo!)}` }] : []),
    { id: "booking-contract-arrival", component: "Text", text: accessText },
    { id: "booking-contract-checkout", component: "Text", text: `Checkout time: ${facts.checkout?.time ?? "11:00"} WAT` },
    { id: "booking-contract-policies", component: "Text", text: `Cancellation terms: ${facts.cancellationPolicy?.summary ?? "See your Booking Contract."} House rules: ${facts.guestConductRules.join("; ") || "See your Booking Contract."}` },
    { id: "booking-contract-references", component: "Text", text: `Booking reference and full contract are in your booking details.${facts.cardMetadata ? ` Card ending ${facts.cardMetadata.last4}.` : ""}` },
  ];
  return [{ version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } }, { version: "v0.9.1", updateComponents: { surfaceId, components } }];
}
