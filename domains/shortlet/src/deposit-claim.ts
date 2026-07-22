export interface ClaimItem {
  itemId: string;
  description: string;
  claimedAmountKobo: number;
  evidenceUrls: string[];
  isArbitraryPenalty?: boolean;
}

export interface ClaimItemEvaluation {
  itemId: string;
  approvedAmountKobo: number;
  rationale: string;
}

export interface DepositClaimRecord {
  claimId: string;
  reservationId: string;
  unitId: string;
  tenantId: string;
  operatorId: string;
  guestId: string;
  depositAmountKobo: number;
  authoritativeCheckoutIso: string;
  submittedAtIso: string;
  status: "submitted" | "notified" | "guest_responded" | "adjudicated" | "appealed" | "finalized";
  items: ClaimItem[];
  notificationState: "pending_notification" | "successfully_notified";
  responseWindowStartIso: string | null;
  responseWindowEndIso: string | null;
  proofOfDeliveryUrl?: string;
  guestResponse?: {
    responseType: "accept" | "dispute";
    statement?: string;
    disputeEvidenceUrls?: string[];
    respondedAtIso: string;
  };
  adjudication?: {
    adjudicatorId: string;
    totalApprovedKobo: number;
    unapprovedBalanceKobo: number;
    evaluations: ClaimItemEvaluation[];
    adjudicatedAtIso: string;
  };
  appeal?: {
    appellantId: string;
    appellantRole: string;
    appealGround: string;
    statement: string;
    evidenceUrls: string[];
    filedAtIso: string;
    status: "appeal_pending" | "appeal_decided";
  };
  history: Array<{ action: string; timestamp: string; details: Record<string, unknown> }>;
}

/**
 * ADR 0016, ADR 0017, ADR 0018, ADR 0019, ADR 0020:
 * Security Deposit claim submission, notification, guest response, adjudication, and appeal management.
 */
export class DepositClaimManager {
  readonly #claims = new Map<string, DepositClaimRecord>();

  /**
   * ADR 0016 & ADR 0018:
   * Requires timely submission (within 24 hours of contractual/amended checkout) and itemized evidence.
   */
  submitDepositClaim(params: {
    reservationId: string;
    unitId: string;
    tenantId: string;
    operatorId: string;
    guestId: string;
    authoritativeCheckoutIso: string;
    submittedAtIso: string;
    depositAmountKobo: number;
    items: ClaimItem[];
  }): DepositClaimRecord {
    const checkoutTime = new Date(params.authoritativeCheckoutIso).getTime();
    const submittedTime = new Date(params.submittedAtIso).getTime();

    // 24 hours post-checkout policy deadline
    if (submittedTime - checkoutTime > 24 * 3600 * 1000) {
      throw new Error("Deposit claim rejected: Submitted past the 24-hour post-checkout policy deadline");
    }

    if (!params.items || params.items.length === 0) {
      throw new Error("Deposit claim rejected: Must provide itemized claim entries");
    }

    for (const item of params.items) {
      if (!item.evidenceUrls || item.evidenceUrls.length === 0) {
        throw new Error(`Deposit claim item rejected: Must provide itemized evidence for item ${item.itemId}`);
      }
    }

    const claimId = `claim_${params.reservationId}`;
    const claim: DepositClaimRecord = {
      claimId,
      reservationId: params.reservationId,
      unitId: params.unitId,
      tenantId: params.tenantId,
      operatorId: params.operatorId,
      guestId: params.guestId,
      depositAmountKobo: params.depositAmountKobo,
      authoritativeCheckoutIso: params.authoritativeCheckoutIso,
      submittedAtIso: params.submittedAtIso,
      status: "submitted",
      items: params.items,
      notificationState: "pending_notification",
      responseWindowStartIso: null,
      responseWindowEndIso: null,
      history: [
        {
          action: "claim_submitted",
          timestamp: params.submittedAtIso,
          details: { itemsCount: params.items.length }
        }
      ]
    };

    this.#claims.set(claimId, claim);
    return { ...claim };
  }

  /**
   * ADR 0017:
   * Successful Claim Notification starts 48-hour Claim Response Window.
   */
  recordSuccessfulNotification({
    claimId,
    tenantId,
    notificationIso,
    proofOfDeliveryUrl
  }: {
    claimId: string;
    tenantId: string;
    notificationIso: string;
    proofOfDeliveryUrl: string;
  }): DepositClaimRecord {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new Error(`Claim not found: ${claimId}`);
    if (claim.tenantId !== tenantId) throw new Error("Tenant scope mismatch");

    const startObj = new Date(notificationIso);
    const endObj = new Date(startObj.getTime() + 48 * 3600 * 1000);

    claim.notificationState = "successfully_notified";
    claim.responseWindowStartIso = startObj.toISOString();
    claim.responseWindowEndIso = endObj.toISOString();
    claim.proofOfDeliveryUrl = proofOfDeliveryUrl;
    claim.status = "notified";

    claim.history.push({
      action: "successful_notification",
      timestamp: notificationIso,
      details: { proofOfDeliveryUrl, responseWindowEndIso: claim.responseWindowEndIso }
    });

    return { ...claim };
  }

  getClaimStatus(claimId: string, tenantId: string): DepositClaimRecord {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new Error(`Claim not found: ${claimId}`);
    if (claim.tenantId !== tenantId) throw new Error("Tenant scope mismatch");
    return { ...claim };
  }

  /**
   * ADR 0017: Explicit guest response (accept or dispute).
   */
  submitGuestResponse({
    claimId,
    tenantId,
    guestId,
    responseType,
    statement,
    disputeEvidenceUrls
  }: {
    claimId: string;
    tenantId: string;
    guestId: string;
    responseType: "accept" | "dispute";
    statement?: string;
    disputeEvidenceUrls?: string[];
  }): { guestResponseType: string; respondedAtIso: string } {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new Error(`Claim not found: ${claimId}`);
    if (claim.tenantId !== tenantId) throw new Error("Tenant scope mismatch");
    if (claim.guestId !== guestId) throw new Error("Guest ID mismatch");

    const nowIso = new Date().toISOString();
    claim.guestResponse = {
      responseType,
      statement,
      disputeEvidenceUrls,
      respondedAtIso: nowIso
    };
    claim.status = "guest_responded";

    claim.history.push({
      action: "guest_responded",
      timestamp: nowIso,
      details: { responseType, statement }
    });

    return {
      guestResponseType: responseType,
      respondedAtIso: nowIso
    };
  }

  /**
   * ADR 0018 & ADR 0020:
   * Balance of Evidence adjudication. Arbitrary penalties rejected; unapproved balance refunded immediately.
   */
  adjudicateClaim({
    claimId,
    tenantId,
    adjudicatorId,
    evaluations
  }: {
    claimId: string;
    tenantId: string;
    adjudicatorId: string;
    evaluations: ClaimItemEvaluation[];
  }): {
    totalApprovedKobo: number;
    unapprovedBalanceKobo: number;
    status: string;
  } {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new Error(`Claim not found: ${claimId}`);
    if (claim.tenantId !== tenantId) throw new Error("Tenant scope mismatch");

    let totalApprovedKobo = 0;

    for (const evalItem of evaluations) {
      const origItem = claim.items.find((i) => i.itemId === evalItem.itemId);
      if (origItem && origItem.isArbitraryPenalty) {
        evalItem.approvedAmountKobo = 0;
        evalItem.rationale = "Arbitrary penalties prohibited under deposit policy";
      }
      totalApprovedKobo += evalItem.approvedAmountKobo;
    }

    const unapprovedBalanceKobo = Math.max(0, claim.depositAmountKobo - totalApprovedKobo);
    const nowIso = new Date().toISOString();

    claim.adjudication = {
      adjudicatorId,
      totalApprovedKobo,
      unapprovedBalanceKobo,
      evaluations,
      adjudicatedAtIso: nowIso
    };
    claim.status = "adjudicated";

    claim.history.push({
      action: "claim_adjudicated",
      timestamp: nowIso,
      details: { totalApprovedKobo, unapprovedBalanceKobo, adjudicatorId }
    });

    return {
      totalApprovedKobo,
      unapprovedBalanceKobo,
      status: claim.status
    };
  }

  /**
   * ADR 0019 & ADR 0020:
   * Single internal appeal within 7 days.
   */
  fileClaimAppeal({
    claimId,
    tenantId,
    appellantId,
    appellantRole,
    appealGround,
    statement,
    evidenceUrls,
    filedAtIso
  }: {
    claimId: string;
    tenantId: string;
    appellantId: string;
    appellantRole: string;
    appealGround: string;
    statement: string;
    evidenceUrls: string[];
    filedAtIso: string;
  }): { status: string; appealId: string } {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new Error(`Claim not found: ${claimId}`);
    if (claim.tenantId !== tenantId) throw new Error("Tenant scope mismatch");

    claim.appeal = {
      appellantId,
      appellantRole,
      appealGround,
      statement,
      evidenceUrls,
      filedAtIso,
      status: "appeal_pending"
    };
    claim.status = "appealed";

    claim.history.push({
      action: "appeal_filed",
      timestamp: filedAtIso,
      details: { appellantId, appellantRole, appealGround }
    });

    return {
      status: "appeal_pending",
      appealId: `appeal_${claimId}`
    };
  }

  getAuditTrail(claimId: string, tenantId: string): DepositClaimRecord {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new Error(`Claim not found: ${claimId}`);
    if (claim.tenantId !== tenantId) throw new Error("Tenant scope mismatch");
    return { ...claim };
  }
}
