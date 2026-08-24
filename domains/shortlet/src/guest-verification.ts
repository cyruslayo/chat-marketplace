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
    const verificationResult = this.#verificationResults?.getVerificationResult({
      tenantId,
      guestId: primaryGuest.id
    });
    if (
      !verificationResult ||
      verificationResult.tenantId !== tenantId ||
      verificationResult.guestId !== primaryGuest.id ||
      verificationResult.governmentIdVerified !== true
    ) {
      throw new Error("Unverified Primary Guest: authoritative government-ID verification is required before disclosure");
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

    const disclosureId = `disc-${crypto.randomUUID()}`;
    const projection = Object.freeze({
      disclosureId,
      unitId,
      primaryGuestId: primaryGuest.id,
      primaryGuestName: primaryGuest.name,
      isVerified: true,
      occupantCount: occupants.length,
      distinctPayerAttached: !!distinctPayer
    });
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

  getInteractionProjection(disclosureId: string) {
    const disclosure = this.#disclosures.get(disclosureId);
    if (!disclosure) throw new Error(`Disclosure not found: ${disclosureId}`);
    return { ...disclosure.projection };
  }
}
