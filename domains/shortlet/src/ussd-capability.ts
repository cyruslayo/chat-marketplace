import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

/**
 * ADR 0049 & ADR 0050: Strictly reject raw credentials (PAN, CVV, PIN, OTP, etc.)
 */
function assertNoRawCardCredentials(payload: Record<string, unknown>): void {
  if (!payload || typeof payload !== "object") return;
  const forbiddenKeys = [
    "pan",
    "cvv",
    "cvc",
    "pin",
    "otp",
    "reusableToken",
    "cardToken",
    "cardNumber",
    "secret",
    "card_number",
    "cvv_code"
  ];
  for (const key of forbiddenKeys) {
    if (key in payload && payload[key] !== undefined && payload[key] !== null) {
      throw new Error(`Security policy violation: Platform must handle no raw payment credentials (${key})`);
    }
  }
}

export interface PaymentCapabilityCertification {
  readonly capabilityId: string;
  readonly providerId: string;
  readonly channel: "ussd" | "card" | "bank_transfer";
  version: number;
  status: "certified" | "uncertified" | "expired" | "suspended";
  certifiedAt: string;
  expiresAt: string;
  auditTrail: { readonly action: string; readonly timestamp: string; readonly updatedBy: string }[];
}

export interface CardAuthenticationOutcome {
  readonly outcomeId: string;
  readonly pspReference: string;
  readonly authType: "frictionless" | "challenged_step_up" | "rejected" | "pending";
  readonly verified: boolean;
  readonly riskScore?: number;
  readonly redactedMetadata: { readonly brand: string; readonly last4: string; readonly issuerCountry?: string };
}

export interface PaymentCapabilityManagerOptions {
  readonly certifications?: PaymentCapabilityCertification[];
  readonly audit?: {
    record(entry: Record<string, unknown>): void;
  };
}

export interface UssdSession {
  readonly sessionId: string;
  readonly capabilityId: string;
  readonly offerId: string;
  readonly amountKobo: number;
  readonly ussdCode: string;
  readonly expiresAt: string;
  readonly status: "active" | "completed" | "expired";
}

export class PaymentCapabilityManager {
  readonly #certifications = new Map<string, PaymentCapabilityCertification>();
  readonly #audit?: PaymentCapabilityManagerOptions["audit"];
  readonly #sessions = new Map<string, UssdSession>();

  constructor(options: PaymentCapabilityManagerOptions = {}) {
    this.#audit = options.audit;
    if (options.certifications) {
      for (const cert of options.certifications) {
        this.#certifications.set(cert.capabilityId, {
          ...cert,
          auditTrail: [...cert.auditTrail]
        });
      }
    }
  }

  /**
   * ADR 0048 & AC 1: Return available payment capabilities, excluding uncertified, expired, or suspended capabilities.
   */
  getAvailablePaymentCapabilities(
    _channelContext?: string,
    clock: () => Date = () => new Date()
  ): readonly PaymentCapabilityCertification[] {
    const now = clock();
    const available: PaymentCapabilityCertification[] = [];

    for (const cert of this.#certifications.values()) {
      const isExpired = new Date(cert.expiresAt).getTime() <= now.getTime();
      if (cert.status === "certified" && !isExpired) {
        available.push({ ...cert, auditTrail: [...cert.auditTrail] });
      }
    }

    return Object.freeze(available);
  }

  /**
   * ADR 0048 & AC 2: Authoritative certification update.
   */
  updateCertificationStatus(
    envelope: PlatformCommandEnvelope<{
      capabilityId: string;
      status: "certified" | "uncertified" | "expired" | "suspended";
      reason?: string;
    }>,
    clock: () => Date = () => new Date()
  ): PaymentCapabilityCertification {
    if (!envelope || envelope.commandName !== "payment_capability.update_certification") {
      throw new Error("Invalid envelope: commandName must be 'payment_capability.update_certification'");
    }

    const { capabilityId, status, reason } = envelope.payload;
    const existing = this.#certifications.get(capabilityId);
    if (!existing) {
      throw new Error(`Payment capability '${capabilityId}' not found`);
    }

    const now = clock();
    const updatedVersion = existing.version + 1;
    const newAuditEntry = {
      action: `status_changed_to_${status}`,
      timestamp: now.toISOString(),
      updatedBy: envelope.principal.id
    };

    const updatedCert: PaymentCapabilityCertification = {
      ...existing,
      version: updatedVersion,
      status,
      auditTrail: [...existing.auditTrail, newAuditEntry]
    };

    this.#certifications.set(capabilityId, updatedCert);

    if (this.#audit) {
      this.#audit.record({
        type: "payment_capability.status_updated",
        capabilityId,
        previousStatus: existing.status,
        newStatus: status,
        version: updatedVersion,
        reason: reason ?? "Status update command",
        updatedAt: now.toISOString(),
        updatedBy: envelope.principal.id
      });
    }

    return { ...updatedCert, auditTrail: [...updatedCert.auditTrail] };
  }

  /**
   * ADR 0048 & AC 2: Re-check certification status immediately before initialization.
   */
  initializeUssdSession(
    envelope: PlatformCommandEnvelope<{
      capabilityId: string;
      offerId: string;
      amountKobo: number;
    }>,
    clock: () => Date = () => new Date()
  ): UssdSession {
    if (!envelope || envelope.commandName !== "payment_capability.initialize_ussd") {
      throw new Error("Invalid envelope: commandName must be 'payment_capability.initialize_ussd'");
    }

    assertNoRawCardCredentials(envelope.payload ?? {});

    const { capabilityId, offerId, amountKobo } = envelope.payload;
    const cert = this.#certifications.get(capabilityId);
    const now = clock();

    const isExpired = cert ? new Date(cert.expiresAt).getTime() <= now.getTime() : true;
    if (!cert || cert.status !== "certified" || isExpired) {
      throw new Error(`Payment capability '${capabilityId}' is not certified, active, or available`);
    }

    const sessionId = `ussd_sess_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`;
    const expiresAt = new Date(now.getTime() + 20 * 60 * 1000).toISOString(); // 20 min payment window
    const ussdCode = `*737*000*${Math.floor(1000 + Math.random() * 9000)}#`;

    const session: UssdSession = {
      sessionId,
      capabilityId,
      offerId,
      amountKobo,
      ussdCode,
      expiresAt,
      status: "active"
    };

    this.#sessions.set(sessionId, session);

    if (this.#audit) {
      this.#audit.record({
        type: "payment_capability.ussd_session_initialized",
        sessionId,
        capabilityId,
        offerId,
        amountKobo,
        initializedAt: now.toISOString()
      });
    }

    return session;
  }

  /**
   * ADR 0050 & AC 3: Map card authentication outcomes without exposing restricted data.
   */
  mapCardAuthenticationOutcome(
    envelope: PlatformCommandEnvelope<{
      outcome: CardAuthenticationOutcome & Record<string, unknown>;
    }>
  ): CardAuthenticationOutcome {
    if (!envelope || envelope.commandName !== "payment_capability.map_card_auth_outcome") {
      throw new Error("Invalid envelope: commandName must be 'payment_capability.map_card_auth_outcome'");
    }

    const { outcome } = envelope.payload;
    assertNoRawCardCredentials(outcome as Record<string, unknown>);

    if (!outcome.outcomeId || !outcome.pspReference || !outcome.authType) {
      throw new Error("Invalid card authentication outcome structure");
    }

    return {
      outcomeId: outcome.outcomeId,
      pspReference: outcome.pspReference,
      authType: outcome.authType,
      verified: outcome.verified,
      riskScore: outcome.riskScore,
      redactedMetadata: outcome.redactedMetadata
    };
  }

  /**
   * AC 4: Project capabilities consistently to web, agent, and permitted messaging channels.
   */
  projectCapabilityState(
    channel: "web" | "agent" | "whatsapp" | "instagram",
    clock: () => Date = () => new Date()
  ): { readonly channel: string; readonly supportedChannels: readonly string[] } {
    const available = this.getAvailablePaymentCapabilities(channel, clock);
    const channels = Array.from(new Set(available.map((c) => c.channel)));
    return {
      channel,
      supportedChannels: Object.freeze(channels)
    };
  }
}
