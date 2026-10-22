import {
  ConditionalOfferManager,
  type ConditionalBookingOffer,
} from "../../../domains/shortlet/src/index.js";
import {
  createPlatformCommandEnvelope,
  type CommandPrincipal,
} from "../../../packages/platform-core/src/index.js";
import type { BookingRequestApplication } from "./booking-request-application.js";
import { getBookingRequestManager } from "./booking-request-application.js";
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
  readonly store?: import("../../../domains/shortlet/src/index.js").SqliteGuestInteractionStore | null;
  readonly extendedStayPolicy?: import("../../../domains/shortlet/src/index.js").ExtendedStayPolicy;
}

const managers = new WeakMap<ConditionalOfferApplication, ConditionalOfferManager>();
/** Composition seam: the underlying domain manager, for wiring sibling applications. Not a public application API. */
export function getConditionalOfferManager(application: ConditionalOfferApplication): ConditionalOfferManager {
  const manager = managers.get(application);
  if (!manager) throw new Error("ConditionalOfferApplication is not initialized");
  return manager;
}

export class ConditionalOfferApplication {
  readonly #manager: ConditionalOfferManager;
  readonly #clock: () => Date;

  constructor(manager: ConditionalOfferManager, clock: () => Date = () => new Date()) {
    this.#manager = manager;
    managers.set(this, manager);
    this.#clock = clock;
  }

  issue(requestId: string, principal: CommandPrincipal): ConditionalBookingOffer {
    const envelope = createPlatformCommandEnvelope({
      commandName: "conditional_offer.issue",
      principal,
      payload: { requestId },
    });
    return this.#manager.issueOffer(envelope, { clock: this.#clock });
  }

  getArtifact(offerId: string, viewer: CommandPrincipal): ConditionalOfferArtifact {
    return conditionalOfferArtifactFromOffer(this.getOffer(offerId), viewer, this.#clock());
  }

  /** Façade read of the authoritative Conditional Booking Offer. */
  getOffer(offerId: string): ConditionalBookingOffer {
    return this.#manager.getOffer(offerId);
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
    return this.#manager.acceptOffer(envelope, { clock: this.#clock });
  }
}

export function createConditionalOfferApplication({
  bookingRequestApplication,
  clock,
  operatorAuthority,
  store,
  ...managerDependencies
}: ConditionalOfferApplicationDependencies): ConditionalOfferApplication {
  return new ConditionalOfferApplication(
    new ConditionalOfferManager({
      ...managerDependencies,
      bookingRequestManager: getBookingRequestManager(bookingRequestApplication),
      operatorAuthority,
      store,
    }),
    clock ?? (() => new Date()),
  );
}
