/** ADR 0063 launch policy. This identifier is part of every accepted snapshot. */
export const SECURITY_DEPOSIT_POLICY_VERSION = "security-deposit/adr-0063-launch-v1";
export type SecurityDepositBedroomBand = "studio_or_one_bedroom" | "two_bedroom" | "three_plus_bedroom";
export interface SecurityDepositPolicySnapshot {
  readonly policyVersion: typeof SECURITY_DEPOSIT_POLICY_VERSION;
  readonly currency: "NGN";
  readonly accommodationSubtotalKobo: number;
  readonly bedroomBand: SecurityDepositBedroomBand;
  readonly percentageCapKobo: number;
  readonly unitSizeCapKobo: number;
  readonly unitConfiguredDepositKobo: number;
  readonly amountKobo: number;
  readonly collectionRequired: boolean;
}

function money(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer kobo amount`);
  return value;
}
function bedroomBand(value: unknown): SecurityDepositBedroomBand {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new RangeError("authoritative bedrooms must be a non-negative integer");
  return value <= 1 ? "studio_or_one_bedroom" : value === 2 ? "two_bedroom" : "three_plus_bedroom";
}
function capForBand(band: SecurityDepositBedroomBand): number { return band === "studio_or_one_bedroom" ? 10_000_000 : band === "two_bedroom" ? 15_000_000 : 25_000_000; }

/** Production-only calculation. Unit facts and configured amount are trusted server inputs. */
export function calculateSecurityDepositPolicySnapshot(input: { readonly accommodationSubtotalKobo: number; readonly bedrooms: number; readonly configuredDepositKobo?: number }): SecurityDepositPolicySnapshot {
  const accommodationSubtotalKobo = money(input.accommodationSubtotalKobo, "accommodation subtotal");
  const band = bedroomBand(input.bedrooms);
  if (!("configuredDepositKobo" in input)) throw new RangeError("authoritative Unit deposit configuration is required");
  const configured = money(input.configuredDepositKobo, "configured deposit");
  const percentageCapKobo = Math.floor(accommodationSubtotalKobo / 4);
  const unitSizeCapKobo = capForBand(band);
  const permitted = Math.min(percentageCapKobo, unitSizeCapKobo);
  if (configured > permitted) throw new RangeError("configured deposit exceeds the platform policy cap");
  const amountKobo = configured === 0 ? 0 : configured;
  return Object.freeze({ policyVersion: SECURITY_DEPOSIT_POLICY_VERSION, currency: "NGN", accommodationSubtotalKobo, bedroomBand: band, percentageCapKobo, unitSizeCapKobo, unitConfiguredDepositKobo: configured, amountKobo, collectionRequired: amountKobo > 0 });
}

/** Compatibility helper retained for historical consumers; production quote code uses the snapshot API. */
export function calculateRefundableSecurityDeposit({ accommodationKobo, bedrooms = 1, requestedDepositKobo }: { accommodationKobo: number; bedrooms?: number; requestedDepositKobo?: number }): number {
  const percentageCapKobo = Math.floor(accommodationKobo * 0.25);
  const unitSizeCapKobo = bedrooms === 2 ? 15_000_000 : bedrooms >= 3 ? 25_000_000 : 10_000_000;
  const permitted = Math.min(percentageCapKobo, unitSizeCapKobo);
  if (requestedDepositKobo === 0) return 0;
  return typeof requestedDepositKobo === "number" ? Math.min(requestedDepositKobo, permitted) : permitted;
}

export function validateOperatorSecurityDepositDemand(demand: { paymentMethod: string; amountKobo: number }): void {
  if (["cash", "direct_bank_transfer", "pos", "offline", "wire"].includes(demand.paymentMethod.toLowerCase())) throw new Error("Operator policy violation: Off-platform security deposit demands are prohibited");
}

export interface SecurityDepositCollectionCapability { readonly capabilityVersion: string; readonly enabled: boolean; readonly pspProviderId: string; readonly pspApproved: boolean; readonly counselApproved: boolean; readonly collectionModel: "separate_actual_charge" | string; readonly paymentMethod: "fresh_card" | "bank_transfer"; }
export interface SecurityDepositCollectionCapabilityProvider { getCapability(input: { paymentMethod: "fresh_card" | "bank_transfer" }): SecurityDepositCollectionCapability; }
export function assertSecurityDepositCollectionAvailable(provider: SecurityDepositCollectionCapabilityProvider, paymentMethod: "fresh_card" | "bank_transfer"): SecurityDepositCollectionCapability {
  let c: SecurityDepositCollectionCapability;
  try { c = provider.getCapability({ paymentMethod }); } catch { throw new Error("Refundable Security Deposit collection unavailable"); }
  if (!c || !c.enabled || !c.pspApproved || !c.counselApproved || c.collectionModel !== "separate_actual_charge" || !c.capabilityVersion.trim() || !c.pspProviderId.trim() || c.paymentMethod !== paymentMethod) throw new Error("Refundable Security Deposit collection unavailable");
  return Object.freeze({ ...c });
}

export interface SecurityDepositRecord { readonly depositId: string; readonly reservationId: string; readonly depositKobo: number; readonly currency: "NGN"; readonly policyVersion: string; status: "held" | "refunded" | "claimed" | "partially_claimed"; readonly createdAt: string; }
/** @deprecated Compatibility-only API. Production authority is SecurityDepositAccountingRepository. */
export class SecurityDepositManager {
  readonly #deposits = new Map<string, SecurityDepositRecord>();
  registerDepositHold({ reservationId, depositKobo, policyVersion = SECURITY_DEPOSIT_POLICY_VERSION, clock = () => new Date() }: { reservationId: string; depositKobo: number; policyVersion?: string; clock?: () => Date }): SecurityDepositRecord { const record: SecurityDepositRecord = { depositId: `dep_${reservationId}`, reservationId, depositKobo, currency: "NGN", policyVersion, status: "held", createdAt: clock().toISOString() }; this.#deposits.set(reservationId, record); return { ...record }; }
  processFullRefund(reservationId: string, { clock = () => new Date() } = {}): { refundId: string; amountKobo: number; status: "refunded"; refundedAt: string } { const deposit = this.#deposits.get(reservationId); if (!deposit) throw new Error("Security deposit record not found"); deposit.status = "refunded"; return { refundId: `ref_dep_${reservationId}`, amountKobo: deposit.depositKobo, status: "refunded", refundedAt: clock().toISOString() }; }
}
