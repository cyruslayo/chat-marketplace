import { PlatformCommandEnvelope, type CommandPrincipal, type ProviderCapabilityCertifier } from "../../../packages/platform-core/src/index.js";
import type { ConditionalBookingOffer } from "./conditional-offer.js";
import { LivePaymentAttemptRegistry } from "./payment-attempt.js";

function assertNoRawCardCredentials(payload: Record<string, unknown>): void {
  const forbidden = ["pan", "cvv", "cvc", "pin", "otp", "reusableToken", "cardToken", "cardNumber", "card_number", "challengePayload", "rawProviderPayload"];
  for (const key of forbidden) if (key in payload && payload[key] !== undefined) throw new Error(`Security policy violation: Platform must handle no raw payment credentials (${key})`);
}

export interface PaymentCapabilityCertification {
  readonly capabilityId: string; readonly providerId: string; readonly channel: "ussd" | "card" | "bank_transfer";
  version: number; status: "certified" | "uncertified" | "expired" | "suspended"; certifiedAt: string; expiresAt: string;
  auditTrail: { readonly action: string; readonly timestamp: string; readonly updatedBy: string }[];
}
export type CardAuthenticationStatus = "verified" | "pending" | "rejected" | "unverified";
export interface CardAuthenticationOutcome {
  readonly outcomeId: string; readonly pspReference: string; readonly authType: "frictionless" | "challenged_step_up" | "rejected" | "pending";
  readonly status?: CardAuthenticationStatus; readonly verified: boolean;
  readonly riskScore?: number; readonly redactedMetadata: { readonly brand: string; readonly last4: string; readonly issuerCountry?: string };
}
export interface UssdProviderClient {
  initializeSession(input: { capabilityId: string; offerId: string; amountKobo: number; currency: "NGN"; expiresAt: string }): { providerSessionId: string; ussdCode: string; providerReference?: string; expiresAt?: string };
}
export interface PaymentCapabilityManagerOptions {
  readonly certifications?: PaymentCapabilityCertification[];
  readonly audit?: { record(entry: Record<string, unknown>): void };
  readonly providerCertifier?: ProviderCapabilityCertifier;
  readonly offerManager?: { getOffer(offerId: string): ConditionalBookingOffer };
  readonly ussdProvider?: UssdProviderClient;
  readonly liveAttempts?: LivePaymentAttemptRegistry;
}
export interface UssdSession {
  readonly sessionId: string; readonly providerSessionId: string; readonly capabilityId: string; readonly offerId: string;
  readonly amountKobo: number; readonly currency: "NGN"; readonly ussdCode: string; readonly expiresAt: string;
  readonly status: "active" | "completed" | "expired";
}

export class PaymentCapabilityManager {
  readonly #certifications = new Map<string, PaymentCapabilityCertification>(); readonly #audit?: PaymentCapabilityManagerOptions["audit"];
  readonly #providerCertifier?: ProviderCapabilityManagerOptionsProvider; readonly #offerManager?: PaymentCapabilityManagerOptions["offerManager"];
  readonly #ussdProvider?: UssdProviderClient; readonly #liveAttempts: LivePaymentAttemptRegistry; readonly #sessions = new Map<string, UssdSession>();
  constructor(options: PaymentCapabilityManagerOptions = {}) {
    this.#audit = options.audit; this.#providerCertifier = options.providerCertifier; this.#offerManager = options.offerManager; this.#ussdProvider = options.ussdProvider; this.#liveAttempts = options.liveAttempts ?? new LivePaymentAttemptRegistry();
    for (const cert of options.certifications ?? []) this.#certifications.set(cert.capabilityId, { ...cert, auditTrail: [...cert.auditTrail] });
  }
  #isActive(cert: PaymentCapabilityCertification, now: Date): boolean {
    if (cert.status !== "certified" || now.getTime() >= new Date(cert.expiresAt).getTime()) return false;
    return !this.#providerCertifier || this.#providerCertifier.isCapabilityEnabled("ussd", cert.providerId, now);
  }
  getAvailablePaymentCapabilities(_channelContext?: string, clock: () => Date = () => new Date()): readonly PaymentCapabilityCertification[] {
    const now = clock(); return Object.freeze([...this.#certifications.values()].filter((c) => this.#isActive(c, now)).map((c) => ({ ...c, auditTrail: [...c.auditTrail] })));
  }
  getCertification(capabilityId: string): PaymentCapabilityCertification | undefined { const c = this.#certifications.get(capabilityId); return c && { ...c, auditTrail: [...c.auditTrail] }; }
  liveAttempt(offerId: string, clock: () => Date = () => new Date()) { return this.#liveAttempts.current(offerId, clock()); }
  updateCertificationStatus(envelope: PlatformCommandEnvelope<{ capabilityId: string; status: PaymentCapabilityCertification["status"]; reason?: string }>, clock: () => Date = () => new Date()): PaymentCapabilityCertification {
    if (envelope?.commandName !== "payment_capability.update_certification") throw new Error("Invalid certification command");
    if (envelope.principal.role !== "admin" && envelope.principal.role !== "system") throw new Error("Only trusted administrative authority may update certification");
    const existing = this.#certifications.get(envelope.payload.capabilityId); if (!existing) throw new Error("Payment capability not found");
    if (envelope.expectedVersion !== undefined && envelope.expectedVersion !== existing.version) throw new Error("Certification version mismatch");
    const now = clock(); const version = existing.version + 1;
    const audit = { action: `status_changed_to_${envelope.payload.status}`, timestamp: now.toISOString(), updatedBy: envelope.principal.id };
    const updated = { ...existing, status: envelope.payload.status, version, auditTrail: [...existing.auditTrail, audit] };
    this.#certifications.set(existing.capabilityId, updated); this.#audit?.record({ type: "payment_capability.status_updated", capabilityId: existing.capabilityId, previousStatus: existing.status, newStatus: updated.status, version, updatedBy: envelope.principal.id, updatedAt: audit.timestamp });
    return { ...updated, auditTrail: [...updated.auditTrail] };
  }
  initializeUssdSession(envelope: PlatformCommandEnvelope<{ capabilityId: string; offerId: string }>, clock: () => Date = () => new Date()): UssdSession {
    if (envelope?.commandName !== "payment_capability.initialize_ussd") throw new Error("Invalid USSD initialization command");
    const payload = envelope.payload as unknown as Record<string, unknown>; assertNoRawCardCredentials(payload);
    if (typeof payload.capabilityId !== "string" || typeof payload.offerId !== "string") throw new Error("USSD initialization requires capabilityId and offerId");
    const now = clock(); const cert = this.#certifications.get(payload.capabilityId);
    if (!cert || !this.#isActive(cert, now)) throw new Error(`Payment capability '${payload.capabilityId}' is not certified, active, or available`);
    if (Object.keys(payload).length !== 2) throw new Error("USSD initialization accepts only capabilityId and offerId");
    if (!this.#offerManager || !this.#ussdProvider) throw new Error("Trusted offer and USSD provider clients are required");
    const offer = this.#offerManager.getOffer(payload.offerId); const payer = offer.parties.distinctPayer?.id ?? offer.parties.primaryGuest.id;
    if (offer.status !== "accepted") throw new Error("USSD initialization requires an accepted offer");
    if (envelope.principal.role !== "guest" || !envelope.principal.id || envelope.principal.id !== payer) throw new Error("Only the authoritative payer can initialize USSD");
    if (!offer.tenantId || !envelope.principal.tenantId || envelope.principal.tenantId !== offer.tenantId) throw new Error("Cross-tenant offer access denied");
    const deadline = new Date(offer.paymentWindow.expiresAt); if (now.getTime() >= deadline.getTime()) throw new Error("Payment window has expired");
    // Re-check immediately before the provider boundary; suspension/version changes fail closed.
    const current = this.#certifications.get(cert.capabilityId); if (!current || current.version !== cert.version || !this.#isActive(current, clock())) throw new Error("Payment capability changed before initialization");
    const attempt = this.#liveAttempts.acquire({ offerId: offer.offerId, method: "ussd", purpose: "stay", attemptId: `ussd_${envelope.commandId}`, startedAt: now.toISOString(), expiresAt: deadline.toISOString() });
    let provider: ReturnType<UssdProviderClient["initializeSession"]>;
    try { provider = this.#ussdProvider.initializeSession({ capabilityId: cert.capabilityId, offerId: offer.offerId, amountKobo: offer.totalAmountDueNowKobo, currency: "NGN", expiresAt: deadline.toISOString() }); } catch (error) { this.#liveAttempts.release(offer.offerId); throw error; }
    const effectiveExpiry = provider.expiresAt && new Date(provider.expiresAt).getTime() < deadline.getTime() ? provider.expiresAt : deadline.toISOString();
    const session: UssdSession = { sessionId: attempt.attemptId, providerSessionId: provider.providerSessionId, capabilityId: cert.capabilityId, offerId: offer.offerId, amountKobo: offer.totalAmountDueNowKobo, currency: "NGN", ussdCode: provider.ussdCode, expiresAt: effectiveExpiry, status: "active" };
    this.#sessions.set(session.sessionId, session); this.#audit?.record({ type: "payment_capability.ussd_session_initialized", capabilityId: cert.capabilityId, offerId: offer.offerId, initializedAt: now.toISOString() });
    return { ...session };
  }
  resolveUssdExpiry(offerId: string, clock: () => Date = () => new Date()): UssdSession | undefined {
    const session = [...this.#sessions.values()].find((s) => s.offerId === offerId); if (!session) return undefined;
    if (clock().getTime() >= new Date(session.expiresAt).getTime() && session.status === "active") { const expired = { ...session, status: "expired" as const }; this.#sessions.set(session.sessionId, expired); this.#liveAttempts.release(offerId); return expired; }
    return { ...session };
  }
  mapCardAuthenticationOutcome(envelope: PlatformCommandEnvelope<{ outcome: CardAuthenticationOutcome & Record<string, unknown> }>): CardAuthenticationOutcome {
    if (envelope?.commandName !== "payment_capability.map_card_auth_outcome") throw new Error("Invalid card authentication command");
    if (envelope.principal.role !== "system" && envelope.principal.role !== "admin") throw new Error("Card authentication must come from trusted provider authority");
    const outcome = envelope.payload.outcome; assertNoRawCardCredentials(outcome);
    if (!outcome.outcomeId || !outcome.pspReference || !outcome.authType || typeof outcome.verified !== "boolean") throw new Error("Invalid card authentication outcome structure");
    return { outcomeId: outcome.outcomeId, pspReference: outcome.pspReference, authType: outcome.authType, verified: outcome.verified, status: outcome.verified ? "verified" : outcome.authType === "rejected" ? "rejected" : "unverified", redactedMetadata: outcome.redactedMetadata };
  }
  projectCapabilityState(channel: "web" | "agent" | "whatsapp" | "instagram", clock: () => Date = () => new Date()): { readonly channel: string; readonly supportedChannels: readonly string[] } { return { channel, supportedChannels: Object.freeze([...new Set(this.getAvailablePaymentCapabilities(channel, clock).map((c) => c.channel))]) }; }
}
type ProviderCapabilityManagerOptionsProvider = ProviderCapabilityCertifier;
