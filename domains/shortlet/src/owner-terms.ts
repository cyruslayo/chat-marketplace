/**
 * ADR 0089: each Unit records the owner's agreed amounts (nightly rate and
 * mandatory charges) and the platform margin rate as versioned unit data.
 * The Guest price is derived from them, and the owner payable and margin are
 * captured in the quote that the offer snapshots at confirmation (ADR 0077).
 */

export interface OwnerAgreedAmounts {
  readonly nightlyKobo: number;
  readonly mandatoryChargesKobo: number;
}

export interface UnitOwnerTerms {
  readonly agreed: OwnerAgreedAmounts;
  /** The unit's margin rate in basis points: 1500 is 15%. */
  readonly marginBasisPoints: number;
}

/** The owner payable and margin a quote captures; never recalculated after confirmation (ADR 0077, ADR 0089). */
export interface OwnerSettlementSnapshot {
  readonly ownerPayableKobo: number;
  readonly marginKobo: number;
  readonly marginBasisPoints: number;
  readonly agreed: OwnerAgreedAmounts;
  readonly nights: number;
  readonly currency: "NGN";
}

export class OwnerTermsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerTermsError";
  }
}

function isNonNegativeKobo(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Rounded down to whole kobo, as tax and commission are in quote.ts. */
export function marginOnKobo(agreedKobo: number, marginBasisPoints: number): number {
  return Math.floor((agreedKobo * marginBasisPoints) / 10_000);
}

/** ADR 0089: the Guest pays the agreed amounts plus the margin, shown as one price. */
export function guestPriceFromOwnerTerms(terms: UnitOwnerTerms): { readonly nightlyKobo: number; readonly mandatoryFeesKobo: number } {
  return Object.freeze({
    nightlyKobo: terms.agreed.nightlyKobo + marginOnKobo(terms.agreed.nightlyKobo, terms.marginBasisPoints),
    mandatoryFeesKobo: terms.agreed.mandatoryChargesKobo + marginOnKobo(terms.agreed.mandatoryChargesKobo, terms.marginBasisPoints),
  });
}

/** Parses an inventory `margin_percent` cell ("15" or "12.5") into basis points. */
export function parseMarginPercent(value: string, field = "margin_percent"): number {
  const trimmed = value.trim();
  if (trimmed === "") throw new OwnerTermsError(`${field} is required`);
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) throw new OwnerTermsError(`${field} must be a non-negative percentage with at most 2 decimal places`);
  const [whole, fraction = ""] = trimmed.split(".");
  const basisPoints = Number(`${whole}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(basisPoints)) throw new OwnerTermsError(`${field} is too large`);
  return basisPoints;
}

interface PricedUnit {
  readonly id?: string;
  readonly price?: {
    readonly nightlyKobo?: unknown;
    readonly mandatoryFeesKobo?: unknown;
    readonly ownerTerms?: unknown;
  };
}

/**
 * Fails closed (ADR 0089, P4 AC3): a unit without complete owner terms, or
 * whose Guest price no longer derives from them, cannot be quoted.
 */
export function unitOwnerTerms(unit: PricedUnit): UnitOwnerTerms {
  const label = unit.id ? `Unit ${unit.id}` : "Unit";
  const raw = unit.price?.ownerTerms;
  if (raw === null || typeof raw !== "object") throw new OwnerTermsError(`${label} has no owner agreed amounts or margin rate`);
  const terms = raw as { readonly agreed?: unknown; readonly marginBasisPoints?: unknown };
  const agreed = terms.agreed !== null && typeof terms.agreed === "object" ? terms.agreed as { readonly nightlyKobo?: unknown; readonly mandatoryChargesKobo?: unknown } : null;
  if (!agreed || !isNonNegativeKobo(agreed.nightlyKobo) || agreed.nightlyKobo === 0 || !isNonNegativeKobo(agreed.mandatoryChargesKobo)) {
    throw new OwnerTermsError(`${label} has no owner agreed amounts`);
  }
  if (!isNonNegativeKobo(terms.marginBasisPoints)) throw new OwnerTermsError(`${label} has no margin rate`);
  const result: UnitOwnerTerms = Object.freeze({
    agreed: Object.freeze({ nightlyKobo: agreed.nightlyKobo, mandatoryChargesKobo: agreed.mandatoryChargesKobo }),
    marginBasisPoints: terms.marginBasisPoints,
  });
  const guest = guestPriceFromOwnerTerms(result);
  if (unit.price?.nightlyKobo !== guest.nightlyKobo || (unit.price?.mandatoryFeesKobo ?? 0) !== guest.mandatoryFeesKobo) {
    throw new OwnerTermsError(`${label} price does not derive from its owner agreed amounts and margin rate`);
  }
  return result;
}

/** ADR 0089: the owner payable is the owner's agreed amounts for the stay; the margin is the rest of the Guest price. */
export function ownerSettlementFor(terms: UnitOwnerTerms, nights: number): OwnerSettlementSnapshot {
  if (!Number.isSafeInteger(nights) || nights < 1) throw new OwnerTermsError("nights must be a positive integer");
  const guest = guestPriceFromOwnerTerms(terms);
  const ownerPayableKobo = terms.agreed.nightlyKobo * nights + terms.agreed.mandatoryChargesKobo;
  const guestKobo = guest.nightlyKobo * nights + guest.mandatoryFeesKobo;
  return Object.freeze({
    ownerPayableKobo,
    marginKobo: guestKobo - ownerPayableKobo,
    marginBasisPoints: terms.marginBasisPoints,
    agreed: terms.agreed,
    nights,
    currency: "NGN" as const,
  });
}

/** Reads a stored quote's owner settlement (P4); null for a quote captured before owner payables existed. */
export function ownerSettlementFromQuote(quote: unknown): OwnerSettlementSnapshot | null {
  if (quote === null || typeof quote !== "object") return null;
  const raw = (quote as { readonly ownerSettlement?: unknown }).ownerSettlement;
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const agreed = value.agreed !== null && typeof value.agreed === "object" ? value.agreed as Record<string, unknown> : null;
  if (!isNonNegativeKobo(value.ownerPayableKobo) || !isNonNegativeKobo(value.marginKobo) || !isNonNegativeKobo(value.marginBasisPoints)
    || !agreed || !isNonNegativeKobo(agreed.nightlyKobo) || !isNonNegativeKobo(agreed.mandatoryChargesKobo)
    || typeof value.nights !== "number" || !Number.isSafeInteger(value.nights) || value.nights < 1 || value.currency !== "NGN") return null;
  return Object.freeze({
    ownerPayableKobo: value.ownerPayableKobo,
    marginKobo: value.marginKobo,
    marginBasisPoints: value.marginBasisPoints,
    agreed: Object.freeze({ nightlyKobo: agreed.nightlyKobo, mandatoryChargesKobo: agreed.mandatoryChargesKobo }),
    nights: value.nights,
    currency: "NGN" as const,
  });
}

/**
 * Builds a Unit price from owner terms, so fixtures and imports derive the
 * Guest price the same way the quote checks it.
 */
export function unitPriceFromOwnerTerms(input: {
  readonly ownerNightlyKobo: number;
  readonly ownerMandatoryChargesKobo: number;
  readonly marginBasisPoints: number;
  readonly refundableSecurityDepositKobo: number;
  readonly version: string;
}) {
  const ownerTerms: UnitOwnerTerms = Object.freeze({
    agreed: Object.freeze({ nightlyKobo: input.ownerNightlyKobo, mandatoryChargesKobo: input.ownerMandatoryChargesKobo }),
    marginBasisPoints: input.marginBasisPoints,
  });
  const guest = guestPriceFromOwnerTerms(ownerTerms);
  return {
    nightlyKobo: guest.nightlyKobo,
    mandatoryFeesKobo: guest.mandatoryFeesKobo,
    refundableSecurityDepositKobo: input.refundableSecurityDepositKobo,
    version: input.version,
    ownerTerms,
  };
}
