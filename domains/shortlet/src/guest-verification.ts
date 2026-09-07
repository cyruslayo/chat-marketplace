import type { SecurityContext } from "../../../packages/platform-core/src/thread.js";

export const SELF_BOOKING_ATTESTATION_VERSION = "self-booking-v1";
export const DISTINCT_PAYER_ATTESTATION_VERSION = "distinct-payer-v1";

export interface SelfBookingAttestation {
  readonly accepted: boolean;
  readonly version: string;
}

export interface DistinctPayerAttestation {
  readonly accepted: boolean;
  readonly version: string;
}

export interface PrimaryGuest {
  readonly id: string;
  readonly name: string;
  /** Compatibility input only; disclosure never trusts this caller-supplied value. */
  readonly isGovernmentIdVerified?: boolean;
}

export interface GuestIdentityVerificationResult {
  readonly tenantId: string;
  readonly guestId: string;
  readonly governmentIdVerified: boolean;
}

export interface GuestIdentityVerificationResultSource {
  getVerificationResult(input: { tenantId: string; guestId: string }): GuestIdentityVerificationResult | null;
}

export interface OvernightOccupant {
  readonly name: string;
}

export interface DistinctPayer {
  readonly id: string;
  readonly name: string;
}

interface UnitRepositoryLike {
  findById?: (id: string) => { capacity: number } | null;
  findAll?: () => Array<{ id: string; capacity: number }>;
}

export type RestrictedIdentityOperation = "read" | "write";

export interface RestrictedIdentityAuthorizationRequest {
  readonly operation: RestrictedIdentityOperation;
  readonly tenantId: string;
  readonly guestId: string;
}

export type RestrictedIdentityAuthorizer = (
  context: SecurityContext,
  request: RestrictedIdentityAuthorizationRequest
) => boolean;

export class RestrictedIdentityStore {
  #vault = new Map<string, Record<string, unknown>>();
  readonly #authorizer?: RestrictedIdentityAuthorizer;

  constructor({ authorizer }: { authorizer?: RestrictedIdentityAuthorizer } = {}) {
    this.#authorizer = authorizer;
  }

  #assertAuthorized(
    operation: RestrictedIdentityOperation,
    tenantId: string,
    guestId: string,
    context: SecurityContext | null | undefined
  ): void {
    if (
      !context?.principalId ||
      !context.tenantId ||
      !context.sessionId ||
      !tenantId ||
      !guestId ||
      context.tenantId !== tenantId ||
      !this.#authorizer ||
      this.#authorizer(context, { operation, tenantId, guestId }) !== true
    ) {
      throw new Error("Access denied: authorized SecurityContext required for raw identity evidence");
    }
  }

  storeIdentityEvidence(
    {
      tenantId,
      guestId,
      rawEvidence
    }: {
      tenantId: string;
      guestId: string;
      rawEvidence: Record<string, unknown>;
    },
    context: SecurityContext
  ): void {
    this.#assertAuthorized("write", tenantId, guestId, context);
    const key = `${tenantId}:${guestId}`;
    this.#vault.set(key, Object.freeze({ ...rawEvidence }));
  }

  getRawIdentityEvidence(
    tenantId: string,
    guestId: string,
    context?: SecurityContext
  ): Record<string, unknown> | null {
    this.#assertAuthorized("read", tenantId, guestId, context);
    const evidence = this.#vault.get(`${tenantId}:${guestId}`);
    return evidence ? { ...evidence } : null;
  }
}

export interface ValidateDisclosureOptions {
  tenantId: string;
  unitId: string;
  primaryGuest: PrimaryGuest;
  occupants: readonly OvernightOccupant[];
  selfBookingAttestation: SelfBookingAttestation;
  distinctPayer?: DistinctPayer | null;
  distinctPayerAttestation?: DistinctPayerAttestation;
  attestingPrincipalId: string;
}

export interface ValidateBookingEligibilityOptions {
  readonly tenantId: string;
  readonly unitId: string;
  readonly primaryGuest: PrimaryGuest;
  readonly occupants: readonly OvernightOccupant[];
  readonly selfBookingAttestation: SelfBookingAttestation;
  readonly distinctPayer?: DistinctPayer | null;
  readonly distinctPayerAttestation?: DistinctPayerAttestation;
  readonly attestingPrincipalId: string;
}

export interface CheckInEligibilityInput {
  readonly tenantId: string;
  readonly guestId: string;
}

export class GuestVerificationService {
  readonly #repository: UnitRepositoryLike | null;
  readonly #disclosures = new Map<string, { tenantId: string; projection: Readonly<Record<string, unknown>> }>();
  readonly #verificationResults?: GuestIdentityVerificationResultSource;

  constructor({
    repository = null,
    verificationResults
  }: {
    repository?: UnitRepositoryLike | null;
    verificationResults?: GuestIdentityVerificationResultSource;
  } = {}) {
    this.#repository = repository;
    this.#verificationResults = verificationResults;
  }

  validateDisclosure({
    tenantId,
    unitId,
    primaryGuest,
    occupants,
    selfBookingAttestation,
    distinctPayer = null,
    distinctPayerAttestation,
    attestingPrincipalId
  }: ValidateDisclosureOptions) {
    if (!tenantId) throw new Error("tenantId is required for disclosure");
    if (!primaryGuest || !attestingPrincipalId || attestingPrincipalId !== primaryGuest.id) {
      throw new Error("Authenticated principal must be the Primary Guest");
    }
    const verificationResult = this.validateCheckInEligibility({ tenantId, guestId: primaryGuest.id });
    const eligibility = this.#validateBookingRequirements({
      tenantId,
      unitId,
      primaryGuest,
      occupants,
      selfBookingAttestation,
      distinctPayer,
      distinctPayerAttestation,
      attestingPrincipalId,
    });
    const projection = Object.freeze({
      ...eligibility.projection,
      isVerified: true,
    });
    const disclosureId = `disc-${crypto.randomUUID()}`;
    this.#disclosures.set(disclosureId, { tenantId, projection });
    return {
      disclosureId,
      approvedForDisclosure: true,
      distinctPayerAttached: !!distinctPayer,
      verificationResult,
      selfBookingAttestationVersion: selfBookingAttestation.version,
      distinctPayerAttestationVersion: distinctPayer ? distinctPayerAttestation?.version : undefined,
      projection
    };
  }

  validateBookingEligibility(options: ValidateBookingEligibilityOptions) {
    const eligibility = this.#validateBookingRequirements(options);
    const disclosureId = `booking-eligibility-${crypto.randomUUID()}`;
    this.#disclosures.set(disclosureId, { tenantId: options.tenantId, projection: eligibility.projection });
    return {
      disclosureId,
      approvedForDisclosure: true,
      distinctPayerAttached: !!options.distinctPayer,
      selfBookingAttestationVersion: options.selfBookingAttestation.version,
      distinctPayerAttestationVersion: options.distinctPayer ? options.distinctPayerAttestation?.version : undefined,
      projection: eligibility.projection,
    };
  }

  validateCheckInEligibility({ tenantId, guestId }: CheckInEligibilityInput): GuestIdentityVerificationResult {
    if (!tenantId || !guestId) throw new Error("Tenant and Guest are required for Check-In Eligibility");
    return this.#requireIdentityVerification(tenantId, guestId);
  }

  #requireIdentityVerification(tenantId: string, guestId: string): GuestIdentityVerificationResult {
    const verificationResult = this.#verificationResults?.getVerificationResult({ tenantId, guestId });
    if (
      !verificationResult ||
      verificationResult.tenantId !== tenantId ||
      verificationResult.guestId !== guestId ||
      verificationResult.governmentIdVerified !== true
    ) {
      throw new Error("Unverified Primary Guest: authoritative government-ID verification is required before disclosure");
    }
    return verificationResult;
  }

  #validateBookingRequirements({
    tenantId,
    unitId,
    primaryGuest,
    occupants,
    selfBookingAttestation,
    distinctPayer = null,
    distinctPayerAttestation,
    attestingPrincipalId,
  }: ValidateBookingEligibilityOptions) {
    if (!tenantId) throw new Error("tenantId is required for disclosure");
    if (!primaryGuest || !attestingPrincipalId || attestingPrincipalId !== primaryGuest.id) {
      throw new Error("Authenticated principal must be the Primary Guest");
    }
    if (
      selfBookingAttestation?.accepted !== true ||
      selfBookingAttestation.version !== SELF_BOOKING_ATTESTATION_VERSION
    ) {
      throw new Error("Self-Booking attestation is required and unsupported versions are rejected");
    }
    if (occupants.length === 0) {
      throw new Error("At least one overnight occupant is required");
    }
    for (const occupant of occupants) {
      if (!occupant || typeof occupant.name !== "string" || occupant.name.trim() === "") {
        throw new Error("All overnight occupants must be named");
      }
    }
    const normalizedPrimaryGuestName = primaryGuest.name.trim().toLocaleLowerCase();
    if (!occupants.some((occupant) => occupant.name.trim().toLocaleLowerCase() === normalizedPrimaryGuestName)) {
      throw new Error("Primary Guest must be included in the overnight occupant roster");
    }

    if (this.#repository) {
      const unit = this.#repository.findById
        ? this.#repository.findById(unitId)
        : this.#repository.findAll?.().find((candidate) => candidate.id === unitId);
      if (unit && occupants.length > unit.capacity) {
        throw new Error(`Occupancy exceeds Unit capacity (${unit.capacity})`);
      }
    }

    if (distinctPayer) {
      if (distinctPayer.id === primaryGuest.id) {
        throw new Error("Distinct payer must differ from Primary Guest");
      }
      if (
        distinctPayerAttestation?.accepted !== true ||
        distinctPayerAttestation.version !== DISTINCT_PAYER_ATTESTATION_VERSION
      ) {
        throw new Error("Distinct payer attestation is required and unsupported versions are rejected");
      }
    }

    const projection = Object.freeze({
      unitId,
      primaryGuestId: primaryGuest.id,
      primaryGuestName: primaryGuest.name,
      isVerified: false,
      occupantCount: occupants.length,
      distinctPayerAttached: !!distinctPayer
    });
    return { projection };
  }

  getInteractionProjection(disclosureId: string) {
    const disclosure = this.#disclosures.get(disclosureId);
    if (!disclosure) throw new Error(`Disclosure not found: ${disclosureId}`);
    return { ...disclosure.projection };
  }
}
