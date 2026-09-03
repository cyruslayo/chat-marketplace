import {
  ConditionalOfferManager,
  type ConditionalBookingOffer,
} from "../../../domains/shortlet/src/index.js";
import {
  createPlatformCommandEnvelope,
  type CommandPrincipal,
} from "../../../packages/platform-core/src/index.js";
import type { BookingRequestApplication } from "./booking-request-application.js";
import type { OperatorRepresentativeAuthority } from "../../../domains/shortlet/src/index.js";
import {
  conditionalOfferArtifactFromOffer,
  type ConditionalOfferArtifact,
} from "./conditional-offer-artifact.js";

export interface ConditionalOfferApplicationDependencies {
  readonly bookingRequestApplication: BookingRequestApplication;
  readonly repository?: unknown;
  readonly audit?: unknown;
  readonly calendar?: unknown;
  readonly clock?: () => Date;
  readonly operatorAuthority?: OperatorRepresentativeAuthority;
}

export class ConditionalOfferApplication {
  readonly manager: ConditionalOfferManager;
  readonly #clock: () => Date;

  constructor(manager: ConditionalOfferManager, clock: () => Date = () => new Date()) {
    this.manager = manager;
    this.#clock = clock;
  }

  issue(requestId: string, principal: CommandPrincipal): ConditionalBookingOffer {
    const envelope = createPlatformCommandEnvelope({
      commandName: "conditional_offer.issue",
      principal,
      payload: { requestId },
    });
    return this.manager.issueOffer(envelope, { clock: this.#clock });
  }

  getArtifact(offerId: string, viewer: CommandPrincipal): ConditionalOfferArtifact {
    return conditionalOfferArtifactFromOffer(this.manager.getOffer(offerId), viewer, this.#clock());
  }

  accept({
    offerId,
    confirmationToken,
    expectedVersion,
    principal,
  }: {
    readonly offerId: string;
    readonly confirmationToken: string;
    readonly expectedVersion: number | string;
    readonly principal: CommandPrincipal;
  }): ConditionalBookingOffer {
    const envelope = createPlatformCommandEnvelope({
      commandName: "conditional_offer.accept",
      principal,
      expectedVersion,
      payload: { offerId, confirmationToken },
    });
    return this.manager.acceptOffer(envelope, { clock: this.#clock });
  }
}

export function createConditionalOfferApplication({
  bookingRequestApplication,
  clock,
  operatorAuthority,
  ...managerDependencies
}: ConditionalOfferApplicationDependencies): ConditionalOfferApplication {
  return new ConditionalOfferApplication(
    new ConditionalOfferManager({
      ...managerDependencies,
      bookingRequestManager: bookingRequestApplication.manager,
      operatorAuthority,
    }),
    clock ?? (() => new Date()),
  );
}
