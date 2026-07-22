export class RestrictedIdentityStore {
  #vault = new Map<string, any>();

  storeIdentityEvidence({ tenantId, guestId, rawEvidence }: { tenantId: string; guestId: string; rawEvidence: any }) {
    if (!tenantId || !guestId) {
      throw new Error("tenantId and guestId are required for identity storage");
    }
    const key = `${tenantId}:${guestId}`;
    this.#vault.set(key, Object.freeze({ ...rawEvidence }));
  }

  getRawIdentityEvidence(tenantId: string, guestId: string, callerContext: any) {
    if (!tenantId || !callerContext || callerContext.tenantId !== tenantId) {
      throw new Error("Access denied: Tenant scope mismatch or authentication required for raw identity evidence");
    }
    const key = `${tenantId}:${guestId}`;
    const evidence = this.#vault.get(key);
    return evidence ? { ...evidence } : null;
  }
}

export interface ValidateDisclosureOptions {
  tenantId?: string;
  unitId: string;
  primaryGuest: any;
  isPrimaryGuestOccupant: boolean;
  occupants?: any[];
  distinctPayer?: any;
  payerAttestationAccepted?: boolean;
}

export class GuestVerificationService {
  #repository: any;
  #identityStore: any;
  #disclosures = new Map<string, any>();

  constructor({ repository = null, identityStore = null }: { repository?: any; identityStore?: any } = {}) {
    this.#repository = repository;
    this.#identityStore = identityStore;
  }

  validateDisclosure({
    tenantId = "default-tenant",
    unitId,
    primaryGuest,
    isPrimaryGuestOccupant,
    occupants = [],
    distinctPayer = null,
    payerAttestationAccepted = false
  }: ValidateDisclosureOptions) {
    if (!primaryGuest || primaryGuest.isGovernmentIdVerified !== true) {
      throw new Error("Unverified Primary Guest: government-ID verification required before disclosure");
    }

    if (!isPrimaryGuestOccupant) {
      if (distinctPayer) {
        throw new Error("Distinct payer cannot replace Primary Guest: Primary Guest must remain an overnight occupant");
      }
      throw new Error("Prohibited third-party booking: Primary Guest must occupy the unit");
    }

    if (distinctPayer && payerAttestationAccepted !== true) {
      throw new Error("Payer attestation required for distinct payer");
    }

    if (this.#repository) {
      const unit = this.#repository.findById ? this.#repository.findById(unitId) : this.#repository.findAll().find((u: any) => u.id === unitId);
      if (unit && occupants.length > unit.capacity) {
        throw new Error(`Occupancy exceeds Unit capacity (${unit.capacity})`);
      }
    }

    for (const occupant of occupants) {
      if (!occupant || !occupant.name || occupant.name.trim() === "") {
        throw new Error("All overnight occupants must be named");
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

    this.#disclosures.set(disclosureId, projection);

    return {
      disclosureId,
      approvedForDisclosure: true,
      distinctPayerAttached: !!distinctPayer,
      projection
    };
  }

  getInteractionProjection(disclosureId: string) {
    const projection = this.#disclosures.get(disclosureId);
    if (!projection) throw new Error(`Disclosure not found: ${disclosureId}`);
    return { ...projection };
  }
}
