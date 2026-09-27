import { unitPriceFromOwnerTerms, type Unit } from "../../domains/shortlet/src/index.js";

/**
 * ADR 0089: a unit's Guest price derives from the owner's agreed amounts and its margin rate, so a test that changes
 * a price changes the owner terms and re-derives the Guest price, instead of editing the Guest price directly.
 */
export function repricedByOwner(price: Unit["price"], change: { readonly ownerNightlyKobo?: number; readonly ownerMandatoryChargesKobo?: number; readonly marginBasisPoints?: number; readonly version?: string }): Unit["price"] {
  const terms = price.ownerTerms;
  if (!terms) throw new Error("the unit has no owner terms to change");
  return unitPriceFromOwnerTerms({
    ownerNightlyKobo: change.ownerNightlyKobo ?? terms.agreed.nightlyKobo,
    ownerMandatoryChargesKobo: change.ownerMandatoryChargesKobo ?? terms.agreed.mandatoryChargesKobo,
    marginBasisPoints: change.marginBasisPoints ?? terms.marginBasisPoints,
    refundableSecurityDepositKobo: price.refundableSecurityDepositKobo,
    version: change.version ?? `${price.version}-repriced`,
  });
}
