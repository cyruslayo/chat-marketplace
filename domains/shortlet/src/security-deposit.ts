import { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

/**
 * ADR 0063: Calculate Refundable Security Deposit according to bedroom caps and 25% accommodation limit.
 */
export function calculateRefundableSecurityDeposit({
  accommodationKobo,
  bedrooms = 1,
  requestedDepositKobo
}: {
  accommodationKobo: number;
  bedrooms?: number;
  requestedDepositKobo?: number;
}): number {
  if (requestedDepositKobo === 0) return 0;

  // Percentage cap: 25% of accommodation subtotal (ADR 0063)
  const percentageCapKobo = Math.floor(accommodationKobo * 0.25);

  // Unit-size cap (ADR 0063)
  let unitSizeCapKobo = 10_000_000; // ₦100,000 for studio / 1-bedroom
  if (bedrooms === 2) {
    unitSizeCapKobo = 15_000_000; // ₦150,000 for 2-bedroom
  } else if (bedrooms >= 3) {
    unitSizeCapKobo = 25_000_000; // ₦250,000 for 3+ bedrooms
  }

  const effectiveCapKobo = Math.min(percentageCapKobo, unitSizeCapKobo);

  if (typeof requestedDepositKobo === "number") {
    return Math.min(requestedDepositKobo, effectiveCapKobo);
  }

  return effectiveCapKobo;
}

/**
 * ADR 0016 & AC 4: Strictly prohibit off-platform security deposit demands.
 */
export function validateOperatorSecurityDepositDemand(demand: {
  paymentMethod: string;
  amountKobo: number;
}): void {
  const offPlatformMethods = ["cash", "direct_bank_transfer", "pos", "offline", "wire"];
  if (offPlatformMethods.includes(demand.paymentMethod.toLowerCase())) {
    throw new Error("Operator policy violation: Off-platform security deposit demands are prohibited");
  }
}

export interface SecurityDepositRecord {
  readonly depositId: string;
  readonly reservationId: string;
  readonly depositKobo: number;
  readonly currency: "NGN";
  readonly policyVersion: string;
  status: "held" | "refunded" | "claimed" | "partially_claimed";
  readonly createdAt: string;
}

export class SecurityDepositManager {
  readonly #deposits = new Map<string, SecurityDepositRecord>();

  registerDepositHold({
    reservationId,
    depositKobo,
    policyVersion = "security-deposit-v1",
    clock = () => new Date()
  }: {
    reservationId: string;
    depositKobo: number;
    policyVersion?: string;
    clock?: () => Date;
  }): SecurityDepositRecord {
    const depositId = `dep_${reservationId}`;
    const record: SecurityDepositRecord = {
      depositId,
      reservationId,
      depositKobo,
      currency: "NGN",
      policyVersion,
      status: "held",
      createdAt: clock().toISOString()
    };

    this.#deposits.set(reservationId, record);
    return { ...record };
  }

  processFullRefund(reservationId: string, { clock = () => new Date() }: { clock?: () => Date } = {}): {
    refundId: string;
    amountKobo: number;
    status: "refunded";
    refundedAt: string;
  } {
    const deposit = this.#deposits.get(reservationId);
    if (!deposit) throw new Error("Security deposit record not found");

    deposit.status = "refunded";
    return {
      refundId: `ref_dep_${reservationId}`,
      amountKobo: deposit.depositKobo,
      status: "refunded",
      refundedAt: clock().toISOString()
    };
  }
}
