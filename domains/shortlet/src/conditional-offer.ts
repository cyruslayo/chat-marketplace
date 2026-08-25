import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";
import { createStayQuote } from "./quote.js";
import { getUnitOnboardingStatus } from "./onboarding.js";
import * as crypto from "node:crypto";


export interface ConfirmationTokenPayload {
  actorId: string;
  tenantId?: string;
  offerId: string;
  offerVersion: number | string;
  quoteVersion: string;
  totalAmountDueNowKobo: number;
  expiresAt: string;
}

export function createConfirmationToken(payload: ConfirmationTokenPayload): string {
  const data = JSON.stringify({
    ...payload,
    salt: crypto.randomUUID()
  });
  const b64 = Buffer.from(data).toString("base64url");
  const hmac = crypto.createHmac("sha256", "conditional_offer_secret").update(b64).digest("hex");
  return `tok_${b64}.${hmac}`;
}

export function decodeConfirmationToken(token: string): ConfirmationTokenPayload {
  if (!token || !token.startsWith("tok_")) {
    throw new Error("Invalid confirmation token format");
  }
  try {
    const parts = token.slice(4).split(".");
    if (parts.length !== 2) throw new Error("Invalid token format");
    const [b64, hmac] = parts;
    const expectedHmac = crypto.createHmac("sha256", "conditional_offer_secret").update(b64).digest("hex");
    if (hmac !== expectedHmac) {
      throw new Error("Token signature verification failed");
    }
    const json = Buffer.from(b64, "base64url").toString("utf8");
    return JSON.parse(json);
  } catch (e: any) {
    if (e.message === "Token signature verification failed") throw e;
    throw new Error("Invalid confirmation token payload");
  }
}

export interface ConditionalBookingOffer {
  offerId: string;
  offerVersion: number;
  requestId: string;
  readonly inventoryCommitmentId: string;
  unitId: string;
  tenantId?: string;
  parties: {
    primaryGuest: { id: string; name: string; isGovernmentIdVerified?: boolean };
    operator: { id: string; name?: string };
    distinctPayer?: { id: string; name: string } | null;
  };
  unit: {
    id: string;
    title: string;
    propertyId: string;
    location: any;
  };
  dates: {
    checkIn: string;
    checkOut: string;
    nights: number;
  };
  occupants: readonly { name: string }[];
  quote: any;
  refundableSecurityDepositKobo: number;
  totalAmountDueNowKobo: number;
  policies: {
    cancellationPolicy: any;
    guestConductRules: readonly string[];
  };
  disclosures: readonly string[];
  paymentWindow: {
    durationMinutes: number;
    expiresAt: string;
  };
  status: "issued" | "accepted" | "expired" | "stale" | "revoked";
  issuedAt: string;
  acceptedAt?: string;
  confirmationToken: string;
  tokenUsed: boolean;
  aggregateVersions: {
    offerVersion: number;
    pricingVersion: string;
    quoteVersion: string;
    cancellationPolicyVersion: string;
    managementAuthorityVersion: string;
    inspectionVersion: string;
  };
}

export class ConditionalOfferManager {
  #repository: any;
  #audit: any;
  #calendar: any;
  #bookingRequestManager: any;
  #offers = new Map<string, ConditionalBookingOffer>();

  constructor({
    repository = null,
    audit = null,
    calendar = null,
    bookingRequestManager = null
  }: {
    repository?: any;
    audit?: any;
    calendar?: any;
    bookingRequestManager?: any;
  } = {}) {
    this.#repository = repository;
    this.#audit = audit;
    this.#calendar = calendar;
    this.#bookingRequestManager = bookingRequestManager;
  }

  issueOffer(
    envelope: PlatformCommandEnvelope<{ requestId: string }>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): ConditionalBookingOffer {
    if (!envelope || envelope.commandName !== "conditional_offer.issue") {
      throw new Error("Invalid envelope: commandName must be 'conditional_offer.issue'");
    }

    const { requestId } = envelope.payload ?? {};
    if (!requestId) throw new Error("requestId is required to issue an offer");
    if (envelope.principal.role !== "operator") {
      throw new Error("Only an authenticated Operator can issue an offer");
    }
    if (!envelope.principal.tenantId) throw new Error("Authenticated tenant is required to issue an offer");

    if (!this.#bookingRequestManager) {
      throw new Error("bookingRequestManager is required to issue an offer");
    }

    const request = this.#bookingRequestManager.getRequest(requestId);
    if (!request.tenantId || request.tenantId !== envelope.principal.tenantId) {
      throw new Error("Cross-tenant request access denied");
    }
    if (!request.operatorId || envelope.principal.id !== request.operatorId) {
      throw new Error("Authenticated principal is not authorized for this Operator action");
    }
    if (request.status !== "confirmed") {
      throw new Error(`Cannot issue offer for request in status '${request.status}' (must be confirmed)`);
    }

    let unit = null;
    if (this.#repository) {
      unit = this.#repository.findById
        ? this.#repository.findById(request.unitId)
        : this.#repository.findAll().find((u: any) => u.id === request.unitId);
    }
    if (!unit) throw new Error(`Unit not found: ${request.unitId}`);

    const now = clock();

    // 1. Revalidate Unit eligibility & authority through checkout
    const onboardingStatus = getUnitOnboardingStatus(unit, now);
    if (!onboardingStatus.eligibleForPublication || onboardingStatus.blockers.length > 0) {
      throw new Error(`Offer creation failed: Unit eligibility/authority invalidated (${onboardingStatus.blockers.join("; ")})`);
    }

    if (!request.inventoryCommitmentId || !this.#calendar) {
      throw new Error("Offer creation failed: request inventory commitment is required");
    }

    try {
      this.#calendar.assertActiveCommitment({
        commitmentId: request.inventoryCommitmentId,
        unitId: request.unitId,
        start: request.checkIn,
        end: request.checkOut,
        expectedKind: "payment_pending",
        clock
      });
    } catch {
      throw new Error("Offer creation failed: request inventory commitment is no longer valid");
    }

    // 2. Revalidate Quote & Aggregate Versions
    const freshQuote = createStayQuote({
      unit,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      partySize: request.occupants.length || 1,
      selectedOptionalServices: request.quote?.lineItems?.optionalServices ?? [],
      clock
    });

    const offerId = `offer-${crypto.randomUUID()}`;
    const offerVersion = 1;
    const paymentWindowDurationMinutes = 20; // ADR 0044
    const paymentWindowStart = request.confirmedAt ? new Date(request.confirmedAt) : now;
    const paymentWindowExpiresAt = new Date(paymentWindowStart.getTime() + paymentWindowDurationMinutes * 60 * 1000).toISOString();

    const aggregateVersions = Object.freeze({
      offerVersion,
      pricingVersion: unit.price?.version ?? "price-v1",
      quoteVersion: freshQuote.quoteVersion,
      cancellationPolicyVersion: freshQuote.cancellationPolicy?.version ?? "cancellation-v1",
      managementAuthorityVersion: unit.managementAuthority?.id ?? "auth-v1",
      inspectionVersion: unit.inspection?.id ?? "insp-v1"
    });

    const tenantId = envelope.principal.tenantId;
    const confirmationToken = createConfirmationToken({
      actorId: request.primaryGuest.id,
      tenantId,
      offerId,
      offerVersion,
      quoteVersion: freshQuote.quoteVersion,
      totalAmountDueNowKobo: freshQuote.totalAmountDueNowKobo,
      expiresAt: paymentWindowExpiresAt
    });

    const disclosures = [
      ...freshQuote.disclosures,
      `Payment must be completed within the 20-minute Payment Window expiring at ${paymentWindowExpiresAt}.`,
      "Failure to complete payment within the deadline will result in offer expiration and release of inventory.",
      "Primary guest identity verification and stay occupancy rules apply strictly to this booking offer."
    ];

    const offer: ConditionalBookingOffer = {
      offerId,
      offerVersion,
      requestId,
      inventoryCommitmentId: request.inventoryCommitmentId,
      unitId: unit.id,
      tenantId,
      parties: Object.freeze({
        primaryGuest: Object.freeze({
          id: request.primaryGuest.id,
          name: request.primaryGuest.name
        }),
        operator: Object.freeze({ id: unit.operator.id, name: unit.operator.name }),
        distinctPayer: request.distinctPayer
          ? Object.freeze({ id: request.distinctPayer.id, name: request.distinctPayer.name })
          : null
      }),
      unit: Object.freeze({
        id: unit.id,
        title: unit.title,
        propertyId: unit.propertyId,
        location: unit.location
      }),
      dates: Object.freeze({
        checkIn: request.checkIn,
        checkOut: request.checkOut,
        nights: request.nights
      }),
      occupants: Object.freeze(request.occupants.map(({ name }: { name: string }) => ({ name }))),
      quote: freshQuote,
      refundableSecurityDepositKobo: freshQuote.refundableSecurityDepositKobo,
      totalAmountDueNowKobo: freshQuote.totalAmountDueNowKobo,
      policies: Object.freeze({
        cancellationPolicy: freshQuote.cancellationPolicy,
        guestConductRules: Object.freeze([
          "Primary guest must personally occupy the unit for the entire stay.",
          "No unauthorized extra occupants or commercial parties permitted.",
          "Strict quiet hours between 10:00 PM and 7:00 AM WAT."
        ])
      }),
      disclosures: Object.freeze(disclosures),
      paymentWindow: Object.freeze({
        durationMinutes: paymentWindowDurationMinutes,
        expiresAt: paymentWindowExpiresAt
      }),
      status: "issued",
      issuedAt: now.toISOString(),
      confirmationToken,
      tokenUsed: false,
      aggregateVersions
    };

    this.#offers.set(offerId, offer);

    if (this.#audit) {
      this.#audit.record({
        type: "conditional_offer.issued",
        offerId,
        requestId,
        unitId: unit.id,
        primaryGuestId: request.primaryGuest.id,
        commandEnvelopeId: envelope.commandId,
        issuedAt: offer.issuedAt
      });
    }

    return { ...offer };
  }

  getOffer(offerId: string): ConditionalBookingOffer {
    const offer = this.#offers.get(offerId);
    if (!offer) throw new Error(`Conditional offer not found: ${offerId}`);
    return offer;
  }

  acceptOffer(
    envelope: PlatformCommandEnvelope<{ offerId: string; confirmationToken: string; expectedVersion?: number | string }>,
    { clock = () => new Date() }: { clock?: () => Date } = {}
  ): ConditionalBookingOffer {
    if (!envelope || envelope.commandName !== "conditional_offer.accept") {
      throw new Error("Invalid envelope: commandName must be 'conditional_offer.accept'");
    }

    const { offerId, confirmationToken } = envelope.payload ?? {};
    if (!offerId) throw new Error("offerId is required to accept an offer");

    const offer = this.getOffer(offerId);

    // 1. Cross-tenant and role checks fail closed.
    if (envelope.principal.role !== "guest" || !offer.tenantId || !envelope.principal.tenantId || offer.tenantId !== envelope.principal.tenantId) {
      throw new Error("Cross-tenant offer access denied");
    }

    // 2. Actor check
    if (envelope.principal.id !== offer.parties.primaryGuest.id) {
      throw new Error("Offer acceptance permitted only for primary guest");
    }

    // 3. Status checks (Replay check)
    if (offer.status === "accepted") {
      throw new Error("Offer has already been accepted");
    }
    if (offer.status === "expired") {
      throw new Error("Offer has expired and cannot be accepted");
    }
    if (offer.status === "stale") {
      throw new Error("Offer terms are stale or changed");
    }
    if (offer.status !== "issued") {
      throw new Error(`Offer in status '${offer.status}' cannot be accepted`);
    }

    // 4. Expected Version check
    const expectedVersion = envelope.expectedVersion;
    if (expectedVersion != null && expectedVersion !== offer.aggregateVersions.offerVersion) {
      throw new Error(`Offer version mismatch: expected ${expectedVersion}, got ${offer.aggregateVersions.offerVersion}`);
    }

    // 5. Unit Revalidation (Stale / Changed check)
    if (this.#repository) {
      const unit = this.#repository.findById
        ? this.#repository.findById(offer.unitId)
        : this.#repository.findAll().find((u: any) => u.id === offer.unitId);
      if (unit) {
        if (unit.inspection?.materialChangePending || !unit.published) {
          offer.status = "stale";
          throw new Error("Offer terms are stale or changed: unit condition or publication status changed");
        }
      }
    }

    // 6. Expiry check (Payment Window deadline)
    const now = clock();
    if (now.getTime() >= new Date(offer.paymentWindow.expiresAt).getTime()) {
      offer.status = "expired";
      if (this.#audit) {
        this.#audit.record({
          type: "conditional_offer.expired",
          offerId,
          unitId: offer.unitId,
          commandEnvelopeId: envelope.commandId,
          expiredAt: now.toISOString()
        });
      }
      throw new Error("Payment window (20 minutes) has expired; offer is no longer valid");
    }

    // 7. Token validation
    if (offer.tokenUsed) {
      throw new Error("Confirmation token has already been used");
    }

    if (confirmationToken !== offer.confirmationToken) {
      throw new Error("Invalid confirmation token");
    }

    // Decode and verify token contents
    let tokenPayload: ConfirmationTokenPayload;
    try {
      tokenPayload = decodeConfirmationToken(confirmationToken);
    } catch {
      throw new Error("Invalid confirmation token payload");
    }

    if (
      tokenPayload.actorId !== offer.parties.primaryGuest.id ||
      tokenPayload.tenantId !== offer.tenantId ||
      tokenPayload.offerId !== offer.offerId ||
      tokenPayload.offerVersion !== offer.offerVersion ||
      tokenPayload.quoteVersion !== offer.aggregateVersions.quoteVersion ||
      tokenPayload.totalAmountDueNowKobo !== offer.totalAmountDueNowKobo ||
      tokenPayload.expiresAt !== offer.paymentWindow.expiresAt
    ) {
      throw new Error("Confirmation token claim validation failed");
    }

    // Mark accepted
    offer.status = "accepted";
    offer.tokenUsed = true;
    offer.acceptedAt = now.toISOString();

    if (this.#audit) {
      this.#audit.record({
        type: "conditional_offer.accepted",
        offerId,
        requestId: offer.requestId,
        unitId: offer.unitId,
        primaryGuestId: offer.parties.primaryGuest.id,
        commandEnvelopeId: envelope.commandId,
        acceptedAt: offer.acceptedAt
      });
    }

    return { ...offer };
  }
}
