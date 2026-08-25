import { conventionalSearchRoute } from "../../web/src/index.js";
import {
  discoveryArtifactToA2UI,
  type DiscoveryArtifactProjection,
} from "./discovery-a2ui.js";
import { bookingRequestArtifactToA2UI } from "./booking-request-a2ui.js";
import type { BookingRequestApplication } from "../../web/src/booking-request-application.js";
import type { BookingRequestArtifact } from "../../web/src/booking-request-artifact.js";
import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";
import { conventionalBookingRequestRoute, conventionalConditionalOfferRoute } from "../../web/src/presentation.js";
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
export { bankTransferArtifactToA2UI } from "./bank-transfer-a2ui.js";

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
