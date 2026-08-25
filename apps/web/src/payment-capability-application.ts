import { createHash } from "node:crypto";
import { createPlatformCommandEnvelope, type CommandPrincipal, type ProviderCapabilityCertifier } from "../../../packages/platform-core/src/index.js";
import { PaymentCapabilityManager, type PaymentCapabilityManagerOptions, type UssdProviderClient, type UssdSession, type PaymentCapabilityCertification, type LivePaymentAttemptRegistry } from "../../../domains/shortlet/src/index.js";
import type { ConditionalOfferApplication } from "./conditional-offer-application.js";
import { paymentCapabilityArtifactFromState, type PaymentCapabilityArtifact } from "./payment-capability-artifact.js";
export interface PaymentCapabilityApplicationOptions { readonly conditionalOfferApplication: ConditionalOfferApplication; readonly certifications: PaymentCapabilityCertification[]; readonly providerCertifier?: ProviderCapabilityCertifier; readonly ussdProvider: UssdProviderClient; readonly liveAttempts?: LivePaymentAttemptRegistry; readonly clock?: () => Date; }
export class PaymentCapabilityApplication {
  readonly manager: PaymentCapabilityManager; readonly #offers: ConditionalOfferApplication; readonly #clock: () => Date;
  constructor(manager: PaymentCapabilityManager, offers: ConditionalOfferApplication, clock: () => Date) { this.manager = manager; this.#offers = offers; this.#clock = clock; }
  getArtifact(offerId: string, viewer: CommandPrincipal): PaymentCapabilityArtifact {
    const offer = this.#offers.manager.getOffer(offerId); const caps = this.manager.getAvailablePaymentCapabilities("web", this.#clock); const session = this.manager.resolveUssdExpiry(offerId, this.#clock); const live = this.manager.liveAttempt(offerId, this.#clock);
    const projectionVersion = createHash("sha256").update(JSON.stringify({ offerId, caps: caps.map((c) => [c.capabilityId, c.version, c.status, c.expiresAt]), live: live ? [live.method, live.attemptId, live.status] : null, session: session ? [session.status, session.expiresAt] : null })).digest("hex").slice(0, 16);
    return paymentCapabilityArtifactFromState({ offer, viewer, capabilities: caps, session, livePaymentMethod: live?.method, projectionVersion });
  }
  initializeUssd(input: { capabilityId: string; offerId: string; trustedPayerPrincipal: CommandPrincipal }): UssdSession { return this.manager.initializeUssdSession(createPlatformCommandEnvelope({ commandName: "payment_capability.initialize_ussd", principal: input.trustedPayerPrincipal, payload: { capabilityId: input.capabilityId, offerId: input.offerId } }), this.#clock); }
}
export function createPaymentCapabilityApplication(options: PaymentCapabilityApplicationOptions): PaymentCapabilityApplication { const clock = options.clock ?? (() => new Date()); const managerOptions: PaymentCapabilityManagerOptions = { certifications: options.certifications, providerCertifier: options.providerCertifier, offerManager: options.conditionalOfferApplication.manager, ussdProvider: options.ussdProvider, liveAttempts: options.liveAttempts }; return new PaymentCapabilityApplication(new PaymentCapabilityManager(managerOptions), options.conditionalOfferApplication, clock); }
