import { conventionalSearchRoute } from "../../web/src/index.js";
import {
  discoveryArtifactToA2UI,
  type DiscoveryArtifactProjection,
} from "./discovery-a2ui.js";
import { bookingRequestArtifactToA2UI } from "./booking-request-a2ui.js";
import type { BookingRequestApplication } from "../../web/src/booking-request-application.js";
import type { BookingRequestArtifact } from "../../web/src/booking-request-artifact.js";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { conventionalBookingRequestRoute, conventionalConditionalOfferRoute, conventionalBookingContractRoute } from "../../web/src/presentation.js";
import type { ConditionalOfferApplication } from "../../web/src/conditional-offer-application.js";
import type { ConditionalOfferArtifact } from "../../web/src/conditional-offer-artifact.js";
import { conditionalOfferArtifactToA2UI } from "./conditional-offer-a2ui.js";
import type { CardPaymentApplication } from "../../web/src/card-payment-application.js";
import type { CardPaymentArtifact } from "../../web/src/card-payment-artifact.js";
import { cardPaymentArtifactToA2UI } from "./card-payment-a2ui.js";
import { conventionalCardPaymentRoute, conventionalBankTransferRoute } from "../../web/src/presentation.js";
import type { BankTransferPaymentApplication } from "../../web/src/bank-transfer-application.js";
import type { BankTransferArtifact } from "../../web/src/bank-transfer-artifact.js";
import { bankTransferArtifactToA2UI } from "./bank-transfer-a2ui.js";
import { bookingContractArtifactToA2UI } from "./booking-contract-a2ui.js";
import type { BookingContractApplication } from "../../web/src/booking-contract-application.js";
import type { BookingContractArtifact } from "../../web/src/booking-contract-artifact.js";
import type { CheckInSupportApplication } from "../../web/src/checkin-support-application.js";
import type { CheckInSupportArtifact } from "../../web/src/checkin-support-artifact.js";
import { checkInSupportArtifactToA2UI } from "./checkin-support-a2ui.js";
import type { CheckoutOverstayApplication } from "../../web/src/checkout-overstay-application.js";
import type { CheckoutArtifact } from "../../web/src/checkout-overstay-artifact.js";
import { checkoutArtifactToA2UI } from "./checkout-overstay-a2ui.js";
import { conventionalCheckInSupportRoute, conventionalCheckoutRoute, conventionalHumanHandoffRoute } from "../../web/src/presentation.js";
import type { HumanHandoffApplication } from "../../web/src/human-handoff-application.js";
import type { SecurityContext } from "../../../packages/platform-core/src/index.js";
import type { HumanHandoffArtifact } from "../../web/src/human-handoff-artifact.js";
import { humanHandoffArtifactToA2UI } from "./human-handoff-a2ui.js";
export { bankTransferArtifactToA2UI } from "./bank-transfer-a2ui.js";

export interface CreateHumanHandoffWebAgentAdapterOptions { readonly application: HumanHandoffApplication; readonly context: SecurityContext; readonly createSurfaceId: (artifactId: string) => string; }
export function createHumanHandoffWebAgentAdapter({ application, context, createSurfaceId }: CreateHumanHandoffWebAgentAdapterOptions) { return Object.freeze({ get(threadId: string) { const artifact: HumanHandoffArtifact = application.getArtifact(threadId, context); const surfaceId = createSurfaceId(artifact.id); return Object.freeze({ channel: "web-agent" as const, artifact, surfaceId, a2uiMessages: humanHandoffArtifactToA2UI({ artifact, surfaceId }), fallback: Object.freeze({ message: artifact.facts.mode, conventionalRoute: conventionalHumanHandoffRoute(threadId) }) }); } }); }
export { bookingContractArtifactToA2UI } from "./booking-contract-a2ui.js";
export { bookingAmendmentArtifactToA2UI } from "./booking-amendment-a2ui.js";
import type { BookingAmendmentApplication } from "../../web/src/booking-amendment-application.js";
import type { BookingAmendmentArtifact } from "../../web/src/booking-amendment-artifact.js";
import { bookingAmendmentArtifactToA2UI } from "./booking-amendment-a2ui.js";
import { conventionalBookingAmendmentRoute } from "../../web/src/presentation.js";
export function createBookingAmendmentWebAgentAdapter(options: { readonly application: BookingAmendmentApplication; readonly principal: CommandPrincipal; readonly createSurfaceId: (artifactId: string) => string }) { return Object.freeze({ get(contractId: string) { const artifact: BookingAmendmentArtifact = options.application.getArtifact(contractId, options.principal); const surfaceId = options.createSurfaceId(artifact.id); return Object.freeze({ channel: "web-agent" as const, artifact, surfaceId, a2uiMessages: bookingAmendmentArtifactToA2UI({ artifact, surfaceId }), fallback: Object.freeze({ message: "Booking Amendment", conventionalRoute: conventionalBookingAmendmentRoute(contractId) }) }); } }); }

function fallbackMessage(artifact: any): string {
  const count = artifact.facts.results.length;
  return count === 0 ? "No eligible Units match those requirements." : `Found ${count} eligible Unit${count === 1 ? "" : "s"}.`;
}

export function conversationalSearch(query: any, filters: any) {
  const artifact = query.search(filters);
  return { channel: "web-agent" as const, message: fallbackMessage(artifact), artifact };
}

export interface WeaverDiscoveryQueryPort {
  search(filters: Readonly<Record<string, unknown>>): DiscoveryArtifactProjection;
}

export interface CreateWeaverWebAgentAdapterOptions {
  readonly query: WeaverDiscoveryQueryPort;
  readonly createSurfaceId: (artifactId: string) => string;
}

export function createWeaverWebAgentAdapter({ query, createSurfaceId }: CreateWeaverWebAgentAdapterOptions) {
  return Object.freeze({
    search(filters: Readonly<Record<string, unknown>>) {
      const artifact = query.search(filters);
      const surfaceId = createSurfaceId(artifact.id);
      const a2uiMessages = discoveryArtifactToA2UI({ artifact, surfaceId });
      const fallback = Object.freeze({
        message: fallbackMessage(artifact),
        conventionalRoute: conventionalSearchRoute(filters),
      });
      return Object.freeze({
        channel: "web-agent" as const,
        artifact,
        surfaceId,
        a2uiMessages,
        fallback,
      });
    },
  });
}

export const createWebAgentAdapter = createWeaverWebAgentAdapter;

export interface CreateBookingRequestWebAgentAdapterOptions {
  readonly application: BookingRequestApplication;
  readonly principal: CommandPrincipal;
  readonly createSurfaceId: (artifactId: string) => string;
}

export interface CreateCardPaymentWebAgentAdapterOptions {
  readonly application: CardPaymentApplication;
  readonly principal: CommandPrincipal;
  readonly createSurfaceId: (artifactId: string) => string;
}

export function createCardPaymentWebAgentAdapter({ application, principal, createSurfaceId }: CreateCardPaymentWebAgentAdapterOptions) {
  return Object.freeze({
    get(offerId: string) {
      const artifact: CardPaymentArtifact = application.getArtifact(offerId, principal);
      const surfaceId = createSurfaceId(artifact.id);
      return Object.freeze({ channel: "web-agent" as const, artifact, surfaceId, a2uiMessages: cardPaymentArtifactToA2UI({ artifact, surfaceId }), fallback: Object.freeze({ message: `Card payment status: ${artifact.facts.status}`, conventionalRoute: conventionalCardPaymentRoute(offerId) }) });
    },
  });
}

export interface CreateBankTransferWebAgentAdapterOptions {
  readonly application: BankTransferPaymentApplication;
  readonly principal: CommandPrincipal;
  readonly createSurfaceId: (artifactId: string) => string;
}

export function createBankTransferWebAgentAdapter({ application, principal, createSurfaceId }: CreateBankTransferWebAgentAdapterOptions) {
  return Object.freeze({
    get(offerId: string) {
      const artifact: BankTransferArtifact = application.getArtifact(offerId, principal);
      const surfaceId = createSurfaceId(artifact.id);
      return Object.freeze({ channel: "web-agent" as const, artifact, surfaceId, a2uiMessages: bankTransferArtifactToA2UI({ artifact, surfaceId }), fallback: Object.freeze({ message: `Bank transfer status: ${artifact.facts.status}`, conventionalRoute: conventionalBankTransferRoute(offerId) }) });
    },
  });
}

export interface CreateConditionalOfferWebAgentAdapterOptions {
  readonly application: ConditionalOfferApplication;
  readonly principal: CommandPrincipal;
  readonly createSurfaceId: (artifactId: string) => string;
}

export function createConditionalOfferWebAgentAdapter({ application, principal, createSurfaceId }: CreateConditionalOfferWebAgentAdapterOptions) {
  return Object.freeze({
    get(offerId: string) {
      const artifact: ConditionalOfferArtifact = application.getArtifact(offerId, principal);
      const surfaceId = createSurfaceId(artifact.id);
      return Object.freeze({
        channel: "web-agent" as const,
        artifact,
        surfaceId,
        a2uiMessages: conditionalOfferArtifactToA2UI({ artifact, surfaceId }),
        fallback: Object.freeze({ message: `Conditional Booking Offer status: ${artifact.facts.status}`, conventionalRoute: conventionalConditionalOfferRoute(offerId) }),
      });
    },
  });
}

export interface CreateBookingContractWebAgentAdapterOptions {
  readonly application: BookingContractApplication;
  readonly principal: CommandPrincipal;
  readonly createSurfaceId: (artifactId: string) => string;
}

export function createBookingContractWebAgentAdapter({ application, principal, createSurfaceId }: CreateBookingContractWebAgentAdapterOptions) {
  return Object.freeze({
    get(contractId: string) {
      const artifact: BookingContractArtifact = application.getArtifact(contractId, principal);
      const surfaceId = createSurfaceId(artifact.id);
      return Object.freeze({ channel: "web-agent" as const, artifact, surfaceId, a2uiMessages: bookingContractArtifactToA2UI({ artifact, surfaceId }), fallback: Object.freeze({ message: "Booking Contract", conventionalRoute: conventionalBookingContractRoute(contractId) }) });
    },
  });
}

export interface CreateCheckInSupportWebAgentAdapterOptions { readonly application: CheckInSupportApplication; readonly principal: CommandPrincipal; readonly contract: { contractId: string; unitId: string }; readonly createSurfaceId: (artifactId: string) => string; }
export function createCheckInSupportWebAgentAdapter({ application, principal, contract, createSurfaceId }: CreateCheckInSupportWebAgentAdapterOptions) {
  return Object.freeze({ get(reservationId: string) { const artifact: CheckInSupportArtifact = application.getArtifact(reservationId, principal, contract); const surfaceId = createSurfaceId(artifact.id); return Object.freeze({ channel: "web-agent" as const, artifact, surfaceId, a2uiMessages: checkInSupportArtifactToA2UI({ artifact, surfaceId }), fallback: Object.freeze({ message: `Check-In status: ${artifact.facts.accessStatus}`, conventionalRoute: conventionalCheckInSupportRoute(reservationId) }) }); } });
}

export interface CreateCheckoutWebAgentAdapterOptions { readonly application: CheckoutOverstayApplication; readonly principal: CommandPrincipal; readonly createSurfaceId: (artifactId: string) => string; }
export function createCheckoutWebAgentAdapter({ application, principal, createSurfaceId }: CreateCheckoutWebAgentAdapterOptions) { return Object.freeze({ get(reservationId: string) { const artifact: CheckoutArtifact = application.getArtifact(reservationId, principal); const surfaceId = createSurfaceId(artifact.id); return Object.freeze({ channel: "web-agent" as const, artifact, surfaceId, a2uiMessages: checkoutArtifactToA2UI({ artifact, surfaceId }), fallback: Object.freeze({ message: `Checkout: ${artifact.facts.effectiveCheckoutTime} WAT`, conventionalRoute: conventionalCheckoutRoute(reservationId) }) }); } }); }

export function createBookingRequestWebAgentAdapter({
  application,
  principal,
  createSurfaceId,
}: CreateBookingRequestWebAgentAdapterOptions) {
  return Object.freeze({
    get(requestId: string) {
      const artifact: BookingRequestArtifact = application.getArtifact(requestId, principal);
      const surfaceId = createSurfaceId(artifact.id);
      return Object.freeze({
        channel: "web-agent" as const,
        artifact,
        surfaceId,
        a2uiMessages: bookingRequestArtifactToA2UI({ artifact, surfaceId }),
        fallback: Object.freeze({
          message: `Booking Request status: ${artifact.facts.status}`,
          conventionalRoute: conventionalBookingRequestRoute(requestId),
        }),
      });
    },
  });
}
