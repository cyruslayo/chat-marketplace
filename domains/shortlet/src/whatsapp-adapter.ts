import { InMemoryAuditLog } from "../../../packages/platform-core/src/index.js";

export interface CapabilityCheckInput {
  actionType: string;
  hasDisclosure: boolean;
  hasAuthentication: boolean;
  hasConsent: boolean;
  hasAuditEvidence: boolean;
}

export interface CapabilityCheckResult {
  actionType: string;
  permittedInChannel: boolean;
  reason?: string;
}

export interface WhatsAppTrackedEvent {
  eventId: string;
  type: "delivery_accepted" | "read" | "response" | "retry" | "channel_switch" | "human_handoff";
  correlationId: string;
  messageId?: string;
  attempt?: number;
  targetChannel?: string;
  targetRole?: string;
  recordedAtIso: string;
}

/**
 * ADR 0067, ADR 0068, ADR 0070, ADR 0077:
 * Projects canonical Interaction Artifacts through WhatsApp, enforces the shared capability matrix,
 * redirects high-impact actions to authenticated web, and tracks correlated channel events.
 */
export class WhatsAppChannelAdapter {
  readonly #auditLog?: InMemoryAuditLog;
  readonly #baseUrl: string;
  readonly #trackedEvents = new Map<string, WhatsAppTrackedEvent[]>();

  constructor({
    auditLog,
    baseUrl = "https://shortlet.platform"
  }: {
    auditLog?: InMemoryAuditLog;
    baseUrl?: string;
  } = {}) {
    this.#auditLog = auditLog;
    this.#baseUrl = baseUrl;
  }

  /**
   * ADR 0077 & AC1:
   * Projects canonical Interaction Artifact to WhatsApp while strictly preserving amounts,
   * absolute WAT deadlines, disclosures, consequences, and consent meaning.
   */
  projectArtifact(canonicalArtifact: any) {
    if (!canonicalArtifact) throw new Error("Canonical artifact is required for WhatsApp projection");

    return Object.freeze({
      channel: "whatsapp" as const,
      artifactId: canonicalArtifact.id,
      kind: canonicalArtifact.kind,
      schemaVersion: canonicalArtifact.schemaVersion,
      domainReferences: Object.freeze(canonicalArtifact.domainReferences ?? []),
      policyVersions: Object.freeze(canonicalArtifact.policyVersions ?? {}),
      disclosures: Object.freeze([...(canonicalArtifact.disclosures ?? [])]),
      amounts: Object.freeze((canonicalArtifact.amounts ?? []).map((a: any) => ({ ...a }))),
      deadlines: Object.freeze((canonicalArtifact.deadlines ?? []).map((d: any) => ({ ...d }))),
      consequences: Object.freeze([...(canonicalArtifact.consequences ?? [])]),
      actions: Object.freeze((canonicalArtifact.actions ?? []).map((act: any) => {
        if (act.requiresAuthenticatedWeb) {
          return {
            ...act,
            webRedirectUrl: `${this.#baseUrl}/auth/web-redirect?artifact=${canonicalArtifact.id}&action=${act.type}`
          };
        }
        return { ...act };
      }))
    });
  }

  /**
   * ADR 0077 & AC2:
   * Shared capability matrix evaluating disclosure, authentication, consent, and audit evidence.
   */
  evaluateCapability(input: CapabilityCheckInput): CapabilityCheckResult {
    if (!input.hasDisclosure) {
      return { actionType: input.actionType, permittedInChannel: false, reason: "Action lacks mandatory disclosure" };
    }
    if (!input.hasAuthentication) {
      return { actionType: input.actionType, permittedInChannel: false, reason: "Action requires authenticated session" };
    }
    if (!input.hasConsent) {
      return { actionType: input.actionType, permittedInChannel: false, reason: "Action lacks required user consent" };
    }
    if (!input.hasAuditEvidence) {
      return { actionType: input.actionType, permittedInChannel: false, reason: "Action lacks audit evidence recording" };
    }

    return { actionType: input.actionType, permittedInChannel: true };
  }

  /**
   * ADR 0070, ADR 0077 & AC3:
   * High-impact actions cannot be completed via WhatsApp identity alone; they are redirected to web.
   */
  executeAction({
    intent,
    payload = {},
    isAuthenticatedWebSession = false
  }: {
    intent: string;
    payload?: any;
    isAuthenticatedWebSession?: boolean;
  }) {
    const highImpactIntents = new Set([
      "pay_reservation",
      "pay_by_card",
      "enter_payment_credentials",
      "upload_identity_document",
      "amend_material_contract_terms",
      "request_deposit_claim_payout",
      "view_full_primary_guest_identity"
    ]);

    if (highImpactIntents.has(intent) && !isAuthenticatedWebSession) {
      const redirectToken = `redir-${crypto.randomUUID()}`;
      const webUrl = `${this.#baseUrl}/auth/web-redirect?intent=${intent}&token=${redirectToken}`;

      this.#auditLog?.record({
        action: "whatsapp_high_impact_web_redirect",
        intent,
        whatsappId: payload.whatsappId,
        webUrl
      });

      return Object.freeze({
        intent,
        channel: "whatsapp",
        redirectedToWeb: true,
        createsContractualState: false,
        webUrl,
        replyMessage: `For security and regulatory compliance, please complete ${intent.replace(/_/g, " ")} on our secure web portal: ${webUrl}`
      });
    }

    if (intent === "view_stay_status") {
      return Object.freeze({
        intent,
        channel: "whatsapp",
        redirectedToWeb: false,
        createsContractualState: false,
        status: "confirmed",
        details: "Stay is confirmed. Access instructions release 24 hours before check-in."
      });
    }

    throw new Error(`Unsupported WhatsApp intent: ${intent}`);
  }

  /**
   * ADR 0077 & AC4:
   * Tracks distinct, correlated events for delivery acceptance, read, response, retry, channel switch, handoff.
   */
  trackMessageEvent(eventInput: {
    type: "delivery_accepted" | "read" | "response" | "retry" | "channel_switch" | "human_handoff";
    correlationId: string;
    messageId?: string;
    attempt?: number;
    targetChannel?: string;
    targetRole?: string;
  }): WhatsAppTrackedEvent {
    const eventId = `wa_evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const trackedEvent: WhatsAppTrackedEvent = {
      eventId,
      type: eventInput.type,
      correlationId: eventInput.correlationId,
      messageId: eventInput.messageId,
      attempt: eventInput.attempt,
      targetChannel: eventInput.targetChannel,
      targetRole: eventInput.targetRole,
      recordedAtIso: new Date().toISOString()
    };

    const list = this.#trackedEvents.get(eventInput.correlationId) ?? [];
    list.push(trackedEvent);
    this.#trackedEvents.set(eventInput.correlationId, list);

    this.#auditLog?.record({
      action: `whatsapp_event_${eventInput.type}`,
      ...trackedEvent
    });

    return Object.freeze({ ...trackedEvent });
  }

  getTrackedEvents(correlationId: string): WhatsAppTrackedEvent[] {
    return (this.#trackedEvents.get(correlationId) ?? []).map((e) => ({ ...e }));
  }
}
