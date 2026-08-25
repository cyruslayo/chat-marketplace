import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import type { BookingRequestApplication } from "./booking-request-application.js";
import type { BookingRequestArtifact } from "./booking-request-artifact.js";
import type { ConditionalOfferApplication } from "./conditional-offer-application.js";
import type { ConditionalOfferArtifact } from "./conditional-offer-artifact.js";
import type { CardPaymentApplication } from "./card-payment-application.js";
import type { CardPaymentArtifact } from "./card-payment-artifact.js";
import type { BankTransferPaymentApplication } from "./bank-transfer-application.js";
import type { BankTransferArtifact } from "./bank-transfer-artifact.js";

export function conventionalSearch(query: any, filters: any) {
  return { channel: "web" as const, artifact: query.search(filters) };
}

export function conventionalSearchRoute(filters: Record<string, any> = {}) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  const query = parameters.toString();
  return `/stays/search${query ? `?${query}` : ""}`;
}

export function conventionalBookingContractRoute(contractId: string): string {
  return `/booking-contracts/${encodeURIComponent(contractId)}`;
}

export function conventionalProtectedArrivalRoute(contractId: string): string {
  return `/booking-contracts/${encodeURIComponent(contractId)}/arrival`;
}

export function conventionalBookingRequestRoute(requestId: string): string {
  return `/booking-requests/${encodeURIComponent(requestId)}`;
}

export function conventionalConditionalOfferRoute(offerId: string): string {
  return `/conditional-offers/${encodeURIComponent(offerId)}`;
}

export function conventionalCardPaymentRoute(offerId: string): string {
  return `/payments/offers/${encodeURIComponent(offerId)}`;
}

export function conventionalBankTransferRoute(offerId: string): string {
  return `/payments/bank-transfer/offers/${encodeURIComponent(offerId)}`;
}

export function conventionalPaymentCapabilitiesRoute(offerId: string): string {
  return `/payments/capabilities/offers/${encodeURIComponent(offerId)}`;
}

export function getConventionalPaymentCapabilitiesView(application: import("./payment-capability-application.js").PaymentCapabilityApplication, offerId: string, principal: CommandPrincipal) {
  return Object.freeze({ route: conventionalPaymentCapabilitiesRoute(offerId), artifact: application.getArtifact(offerId, principal) });
}

export function getConventionalBankTransferView(application: BankTransferPaymentApplication, offerId: string, principal: CommandPrincipal): { readonly route: string; readonly artifact: BankTransferArtifact } {
  return Object.freeze({ route: conventionalBankTransferRoute(offerId), artifact: application.getArtifact(offerId, principal) });
}

export function initializeConventionalBankTransfer(application: BankTransferPaymentApplication, offerId: string, principal: CommandPrincipal): { readonly route: string; readonly artifact: BankTransferArtifact } {
  application.initializeTransfer(offerId, principal);
  return getConventionalBankTransferView(application, offerId, principal);
}

export function getConventionalCardPaymentView(application: CardPaymentApplication, offerId: string, principal: CommandPrincipal): { readonly route: string; readonly artifact: CardPaymentArtifact } {
  return Object.freeze({ route: conventionalCardPaymentRoute(offerId), artifact: application.getArtifact(offerId, principal) });
}

export function initializeConventionalCardPayment(application: CardPaymentApplication, offerId: string, principal: CommandPrincipal): { readonly route: string; readonly artifact: CardPaymentArtifact } {
  application.initializeCheckout(offerId, principal);
  return getConventionalCardPaymentView(application, offerId, principal);
}

export function getConventionalConditionalOfferView(
  application: ConditionalOfferApplication,
  offerId: string,
  principal: CommandPrincipal,
): { readonly route: string; readonly artifact: ConditionalOfferArtifact } {
  return Object.freeze({ route: conventionalConditionalOfferRoute(offerId), artifact: application.getArtifact(offerId, principal) });
}

export function acceptConventionalConditionalOffer(
  application: ConditionalOfferApplication,
  input: { readonly offerId: string; readonly confirmationToken: string; readonly expectedVersion: number | string; readonly principal: CommandPrincipal },
): ConditionalOfferArtifact {
  application.accept(input);
  return application.getArtifact(input.offerId, input.principal);
}

export function getConventionalBookingContractView(application: import("./booking-contract-application.js").BookingContractApplication, contractId: string, principal: CommandPrincipal) {
  return Object.freeze({ route: conventionalBookingContractRoute(contractId), artifact: application.getArtifact(contractId, principal) });
}

export function getConventionalProtectedArrivalView(application: import("./booking-contract-application.js").BookingContractApplication, contractId: string, principal: CommandPrincipal) {
  return Object.freeze({ route: conventionalProtectedArrivalRoute(contractId), view: application.getProtectedArrivalView(contractId, principal) });
}

export function getConventionalBookingRequestView(
  application: BookingRequestApplication,
  requestId: string,
  principal: CommandPrincipal,
): { readonly route: string; readonly artifact: BookingRequestArtifact } {
  return Object.freeze({
    route: conventionalBookingRequestRoute(requestId),
    artifact: application.getArtifact(requestId, principal),
  });
}
