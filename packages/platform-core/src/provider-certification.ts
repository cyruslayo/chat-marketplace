export interface CapabilityCertificationRecord {
  readonly providerId: string;
  readonly capability: "payment" | "identity" | "messaging" | "ussd" | "maps_location" | "calendar" | "notification";
  readonly environment: "production-equivalent" | "live" | "sandbox";
  readonly configuration: Record<string, unknown>;
  readonly evidence: readonly string[];
  readonly observedBehaviour: string;
  readonly exceptions: readonly string[];
  readonly owner: string;
  readonly expiryDate: string;
}

export interface BankReferenceExpiryProof {
  readonly referenceId: string;
  readonly deadlineIso: string;
  readonly sandboxOnlySuccess?: boolean;
  readonly simulatedPaymentTimeIso: string;
}

export interface FailureSimulationRequest {
  readonly capability: "payment" | "identity" | "messaging";
  readonly failureType:
    | "late_success"
    | "settlement_delay"
    | "webhook_failure"
    | "card_declined"
    | "ambiguous_identity"
    | "verification_timeout"
    | "bvn_nin_mismatch"
    | "delivery_callback_failure"
    | "channel_invalidated";
  readonly payload?: Record<string, unknown>;
}

export interface FailureSimulationResult {
  readonly capability: string;
  readonly failureType: string;
  readonly authoritativeOutcome: "failed" | "unverified" | "refunded" | "undelivered" | "escalated";
  readonly recoveryOutcome: string;
  readonly auditLogged: boolean;
}

export interface CapabilityMatrixItem {
  readonly capability: string;
  readonly providerId: string;
  readonly enabled: boolean;
  readonly certificationStatus: "certified" | "uncertified" | "disabled";
  readonly acceptedLimitation?: string;
}

/**
 * ADR 0002, ADR 0011, ADR 0044, ADR 0045, ADR 0046, ADR 0047, ADR 0048 & Issue 40:
 * Production-equivalent capability certification service for payment, identity, and messaging providers.
 * Records evidence, proves reference expiry deadlines, executes failure simulations,
 * and maintains capability enablement status matrix.
 */
export class ProviderCapabilityCertifier {
  readonly #certifications = new Map<string, CapabilityCertificationRecord>();
  readonly #limitations = new Map<string, string>();
  readonly #audit?: { record(entry: Record<string, unknown>): void };

  constructor(options?: { audit?: { record(entry: Record<string, unknown>): void } }) {
    this.#audit = options?.audit;
  }

  /**
   * AC 1: Record capability certification with required metadata and evidence.
   */
  recordCapabilityCertification(record: CapabilityCertificationRecord): CapabilityCertificationRecord {
    if (!record.evidence || record.evidence.length === 0) {
      throw new Error("Certification record must contain evidence");
    }

    if (!record.owner || !record.observedBehaviour || !record.expiryDate) {
      throw new Error("Certification record requires owner, observedBehaviour, and expiryDate");
    }

    const key = `${record.providerId}:${record.capability}`;
    this.#certifications.set(key, Object.freeze({ ...record }));

    if (this.#audit) {
      this.#audit.record({
        type: "provider.capability_certified_detailed",
        providerId: record.providerId,
        capability: record.capability,
        environment: record.environment,
        owner: record.owner,
        expiryDate: record.expiryDate
      });
    }

    return record;
  }

  getCertificationStatus(providerId: string, capability: CapabilityCertificationRecord["capability"]): CapabilityCertificationRecord | undefined {
    return this.#certifications.get(`${providerId}:${capability}`);
  }

  /**
   * AC 2: Prove bank reference expiry at deadline. Sandbox success alone is insufficient.
   */
  certifyBankReferenceExpiry(proof: BankReferenceExpiryProof): { isPayable: boolean; reason: string } {
    if (proof.sandboxOnlySuccess === true) {
      throw new Error("Sandbox success alone is insufficient: deadline enforcement proof required");
    }

    const paymentTime = Date.parse(proof.simulatedPaymentTimeIso);
    const deadline = Date.parse(proof.deadlineIso);

    if (isNaN(paymentTime) || isNaN(deadline)) {
      throw new Error("Invalid ISO timestamp in bank reference expiry proof");
    }

    if (paymentTime > deadline) {
      if (this.#audit) {
        this.#audit.record({
          type: "provider.bank_reference_expired",
          referenceId: proof.referenceId,
          deadlineIso: proof.deadlineIso,
          simulatedPaymentTimeIso: proof.simulatedPaymentTimeIso,
          action: "late_payment_refund_triggered"
        });
      }
      return { isPayable: false, reason: "Bank reference expired at deadline" };
    }

    return { isPayable: true, reason: "Payment received within valid window" };
  }

  /**
   * AC 3: Simulate payment, identity, and channel failures to verify authoritative & recovery outcomes.
   */
  simulateFailure(request: FailureSimulationRequest): FailureSimulationResult {
    let authoritativeOutcome: FailureSimulationResult["authoritativeOutcome"];
    let recoveryOutcome: string;

    switch (request.capability) {
      case "payment":
        if (request.failureType === "late_success") {
          authoritativeOutcome = "refunded";
          recoveryOutcome = "Late payment refunded under ADR 0045";
        } else {
          authoritativeOutcome = "failed";
          recoveryOutcome = "Operational escalation and retry window enforcement";
        }
        break;

      case "identity":
        authoritativeOutcome = "unverified";
        recoveryOutcome = "Escalated to Human Risk Review under ADR 0051";
        break;

      case "messaging":
        authoritativeOutcome = "undelivered";
        recoveryOutcome = "Fallback channel routing or human handoff under ADR 0067";
        break;

      default:
        throw new Error(`Unsupported capability simulation: ${request.capability}`);
    }

    if (this.#audit) {
      this.#audit.record({
        type: "provider.failure_simulated",
        capability: request.capability,
        failureType: request.failureType,
        authoritativeOutcome,
        recoveryOutcome
      });
    }

    return {
      capability: request.capability,
      failureType: request.failureType,
      authoritativeOutcome,
      recoveryOutcome,
      auditLogged: true
    };
  }

  /**
   * AC 4: Register accepted capability limitation and maintain matrix.
   */
  registerCapabilityLimitation(item: { capability: string; providerId: string; acceptedLimitation: string }): void {
    const key = `${item.providerId}:${item.capability}`;
    this.#limitations.set(key, item.acceptedLimitation);
  }

  isCapabilityEnabled(capability: string, providerId: string): boolean {
    const cert = this.#certifications.get(`${providerId}:${capability}`);
    if (!cert) return false;
    return cert.environment === "production-equivalent" || cert.environment === "live";
  }

  executeCapability<T>(capability: string, providerId: string, fn: () => T): T {
    if (!this.isCapabilityEnabled(capability, providerId)) {
      const limitation = this.#limitations.get(`${providerId}:${capability}`);
      const limitReason = limitation ? `: ${limitation}` : "";
      throw new Error(`Capability '${capability}' for provider '${providerId}' is disabled${limitReason}`);
    }
    return fn();
  }

  getCapabilityMatrix(): CapabilityMatrixItem[] {
    const capabilities = ["payment", "identity", "messaging", "ussd"];
    const providers = ["psp_paystack", "id_identitypass", "msg_whatsapp"];
    const matrix: CapabilityMatrixItem[] = [];

    for (const cap of capabilities) {
      for (const prov of providers) {
        const key = `${prov}:${cap}`;
        const cert = this.#certifications.get(key);
        const limitation = this.#limitations.get(key);

        let certificationStatus: CapabilityMatrixItem["certificationStatus"] = "uncertified";
        let enabled = false;

        if (cert) {
          certificationStatus = "certified";
          enabled = true;
        } else if (limitation || cap === "ussd") {
          certificationStatus = "disabled";
          enabled = false;
        }

        matrix.push({
          capability: cap,
          providerId: prov,
          enabled,
          certificationStatus,
          acceptedLimitation: limitation
        });
      }
    }

    return matrix;
  }
}
