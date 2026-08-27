export interface ClaimItem {
  itemId: string;
  description: string;
  claimedAmountKobo: number;
  evidenceUrls: string[];
  isArbitraryPenalty?: boolean;
}

/** Production Issue 26 input: evidence references are assertions, never proof by themselves. */
export interface DepositClaimAssertionItem {
  readonly itemId: string;
  readonly description: string;
  readonly claimedAmountKobo: number;
  readonly evidenceReferenceIds: readonly string[];
}
export type DepositClaimCaseStatus = "allocation_pending" | "validated_notification_pending" | "response_open" | "guest_accepted" | "human_review" | "adjudicated" | "no_claim_refund_pending" | "no_claim_refunded" | "reconciliation_required";
export interface DepositClaimEvidenceAuthority {
  readonly evidenceSetId: string; readonly evidenceVersion: string; readonly reservationId: string; readonly itemId: string;
  readonly references: readonly { readonly evidenceReferenceId: string; readonly type: string; readonly capturedAt: string; readonly classification: "immediate_pre_stay" | "post_checkout" | "repair" | "other"; readonly safeDescription: string }[];
  readonly validation: "approved" | "insufficient" | "requires_additional_evidence";
  readonly occurrenceDuringReservation: "supported" | "unsupported" | "unknown";
  readonly causation: "supported" | "unsupported" | "unknown"; readonly responsibility?: "supported" | "unsupported" | "unknown"; readonly alternativeAccess?: "considered" | "not_considered"; readonly conditionBeforeStay?: "supported" | "unsupported" | "unknown"; readonly repairBasis?: "supported" | "unsupported" | "unknown"; readonly depreciationConsidered?: boolean; readonly bettermentConsidered?: boolean; readonly salvageConsidered?: boolean;
}
export interface DepositClaimProductionItem extends DepositClaimAssertionItem { readonly evidence: DepositClaimEvidenceAuthority; }
export interface DepositClaimProductionRecord {
  readonly claimId: string; readonly reservationId: string; readonly contractId: string; readonly tenantId: string; readonly operatorId: string; readonly guestId: string;
  readonly policyVersion: string; readonly claimPolicyVersion: string; readonly evidenceVersion: string; readonly depositAmountKobo: number; readonly claimedAmountKobo: number; readonly effectiveCheckoutIso: string; readonly claimDeadlineIso: string;
  readonly submittedAtIso: string; readonly claimVersion: number; readonly status: DepositClaimCaseStatus; readonly items: readonly DepositClaimProductionItem[];
  readonly notification: { readonly status: "pending" | "delivered" | "failed"; readonly notificationVersion: string; readonly deliveredAtIso: string | null; readonly evidenceId: string | null };
  readonly responseWindowStartIso: string | null; readonly responseWindowEndIso: string | null;
  readonly guestResponse: { readonly type: "accept" | "dispute"; readonly statement?: string; readonly respondedAtIso: string } | null;
  readonly initialReservedOperatorAwardKobo: number; readonly initialApprovedAmountKobo: number | null; readonly approvedOperatorAwardKobo: number | null; readonly unapprovedRefundKobo: number; readonly history: readonly { readonly action: string; readonly at: string; readonly commandId?: string }[];
}
export interface DepositClaimRepository {
  findByReservationId(reservationId: string): DepositClaimProductionRecord | null;
  findByClaimId(claimId: string): DepositClaimProductionRecord | null;
  createIfAbsent(record: DepositClaimProductionRecord): DepositClaimProductionRecord;
  update(claimId: string, expectedClaimVersion: number, mutation: (current: DepositClaimProductionRecord) => DepositClaimProductionRecord): DepositClaimProductionRecord;
}
export class InMemoryDepositClaimRepository implements DepositClaimRepository {
  readonly #records = new Map<string, DepositClaimProductionRecord>();
  findByReservationId(id: string): DepositClaimProductionRecord | null { return [...this.#records.values()].find((record) => record.reservationId === id) ?? null; }
  findByClaimId(id: string): DepositClaimProductionRecord | null { return this.#records.get(id) ?? null; }
  createIfAbsent(record: DepositClaimProductionRecord): DepositClaimProductionRecord { const old = this.#records.get(record.claimId); if (old) { if (old.reservationId !== record.reservationId) throw new Error("Claim identity conflict"); return old; } this.#records.set(record.claimId, Object.freeze(record)); return record; }
  update(id: string, expected: number, mutation: (current: DepositClaimProductionRecord) => DepositClaimProductionRecord): DepositClaimProductionRecord { const current = this.#records.get(id); if (!current || current.claimVersion !== expected) throw new Error("STALE_ACTION"); const next = mutation(current); if (next.claimId !== current.claimId || next.reservationId !== current.reservationId || next.claimVersion !== expected + 1) throw new Error("Invalid claim version transition"); this.#records.set(id, Object.freeze(next)); return next; }
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
  ledgerStatus?: "reserved" | "internally_final" | "payout_scheduled" | "paid" | "failed" | "externally_disputed";
  internalFinality?: boolean;
  exceptionalStatus?: "none" | "exceptional_reopening";
  payoutProcessedAtIso?: string;
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
    reviewerId?: string;
    decision?: string;
    resolvedAtIso?: string;
  };
  history: Array<{ action: string; timestamp: string; details: Record<string, unknown> }>;
}

/**
 * ADR 0016, ADR 0017, ADR 0018, ADR 0019, ADR 0020:
 * Security Deposit claim submission, notification, guest response, adjudication, appeal, internal finality,
 * payout reservation, and exceptional reopening.
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
      ledgerStatus: "reserved",
      internalFinality: false,
      exceptionalStatus: "none",
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
    claim.ledgerStatus = "reserved";

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

    // Check 7-day appeal window deadline from notification / adjudication
    const startIso = claim.responseWindowStartIso || claim.adjudication?.adjudicatedAtIso || claim.submittedAtIso;
    const startTime = new Date(startIso).getTime();
    const filedTime = new Date(filedAtIso).getTime();

    if (filedTime - startTime > 7 * 24 * 3600 * 1000) {
      throw new Error("Claim Appeal rejected: Exceeds the 7 elapsed calendar days window from notification");
    }

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

  /**
   * ADR 0019:
   * Resolves a claim appeal with an independent, conflict-free human reviewer.
   */
  resolveClaimAppeal({
    claimId,
    tenantId,
    reviewerId,
    decision,
    rationale,
    adjustedApprovedKobo
  }: {
    claimId: string;
    tenantId: string;
    reviewerId: string;
    decision: "affirm" | "reduce" | "reverse" | "correct" | "remand" | "reject_out_of_scope" | "reject_late";
    rationale: string;
    adjustedApprovedKobo?: number;
  }): DepositClaimRecord {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new Error(`Claim not found: ${claimId}`);
    if (claim.tenantId !== tenantId) throw new Error("Tenant scope mismatch");

    // ADR 0019: Independence requirement - reviewer must NOT be original adjudicator
    if (claim.adjudication && claim.adjudication.adjudicatorId === reviewerId) {
      throw new Error("Appeal reviewer must be independent and conflict-free");
    }

    if (!claim.appeal) {
      throw new Error("No appeal filed for this claim");
    }

    const nowIso = new Date().toISOString();
    claim.appeal.status = "appeal_decided";
    claim.appeal.reviewerId = reviewerId;
    claim.appeal.decision = decision;
    claim.appeal.resolvedAtIso = nowIso;

    if (adjustedApprovedKobo !== undefined && claim.adjudication) {
      claim.adjudication.totalApprovedKobo = adjustedApprovedKobo;
      claim.adjudication.unapprovedBalanceKobo = Math.max(0, claim.depositAmountKobo - adjustedApprovedKobo);
    }

    claim.status = "finalized";
    claim.internalFinality = true;
    claim.ledgerStatus = "internally_final";

    claim.history.push({
      action: "appeal_resolved",
      timestamp: nowIso,
      details: { reviewerId, decision, rationale }
    });

    return { ...claim };
  }

  /**
   * ADR 0020:
   * Grants an explicit authenticated guest waiver post-adjudication, reaching Internal Finality immediately.
   */
  grantAuthenticatedGuestWaiver({
    claimId,
    tenantId,
    guestId,
    authenticatedWaiverToken
  }: {
    claimId: string;
    tenantId: string;
    guestId: string;
    authenticatedWaiverToken: string;
  }): DepositClaimRecord {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new Error(`Claim not found: ${claimId}`);
    if (claim.tenantId !== tenantId) throw new Error("Tenant scope mismatch");
    if (claim.guestId !== guestId) throw new Error("Guest ID mismatch");
    if (!authenticatedWaiverToken) throw new Error("Valid authenticated waiver token required");

    claim.status = "finalized";
    claim.internalFinality = true;
    claim.ledgerStatus = "internally_final";

    claim.history.push({
      action: "authenticated_waiver_granted",
      timestamp: new Date().toISOString(),
      details: { guestId }
    });

    return { ...claim };
  }

  /**
   * ADR 0020:
   * Process payout to operator ONLY after Internal Finality. Prevents double payouts.
   */
  processPayout({ claimId, tenantId }: { claimId: string; tenantId: string }): { claimId: string; status: string } {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new Error(`Claim not found: ${claimId}`);
    if (claim.tenantId !== tenantId) throw new Error("Tenant scope mismatch");

    if (claim.ledgerStatus === "paid") {
      throw new Error("Claim award has already been paid");
    }

    if (!claim.internalFinality || claim.ledgerStatus !== "internally_final") {
      throw new Error("Approved award cannot be paid before reaching Internal Finality");
    }

    claim.ledgerStatus = "paid";
    claim.payoutProcessedAtIso = new Date().toISOString();

    claim.history.push({
      action: "payout_processed",
      timestamp: claim.payoutProcessedAtIso,
      details: { amountKobo: claim.adjudication?.totalApprovedKobo }
    });

    return { claimId, status: "paid" };
  }

  /**
   * ADR 0020:
   * Handles closure deadlines for unnotified claims (Day 14 assisted review, Day 45 reserve release, Day 90 final closure).
   */
  handleUnnotifiedClaimDeadline({
    claimId,
    tenantId,
    checkTimeIso
  }: {
    claimId: string;
    tenantId: string;
    checkTimeIso: string;
  }): { actionRequired: string } {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new Error(`Claim not found: ${claimId}`);
    if (claim.tenantId !== tenantId) throw new Error("Tenant scope mismatch");

    const submittedTime = new Date(claim.submittedAtIso).getTime();
    const checkTime = new Date(checkTimeIso).getTime();
    const daysDiff = (checkTime - submittedTime) / (24 * 3600 * 1000);

    let actionRequired = "none";
    if (daysDiff >= 90) {
      actionRequired = "final_closure";
      claim.status = "finalized";
    } else if (daysDiff >= 45) {
      actionRequired = "reserve_release_to_guest";
    } else if (daysDiff >= 14) {
      actionRequired = "assisted_review";
    }

    return { actionRequired };
  }

  /**
   * ADR 0019:
   * Exceptional reopening for fraud, court, or legal hold without silently resetting ordinary 7-day appeal rights.
   */
  triggerExceptionalReopening({
    claimId,
    tenantId,
    reason,
    evidence,
    authorizedBy
  }: {
    claimId: string;
    tenantId: string;
    reason: "fraud" | "misattributed_evidence" | "duplicate_money" | "system_defect" | "regulatory_court_direction" | "material_safety_incident";
    evidence: string;
    authorizedBy: string;
  }): { exceptionalStatus: string; recordPreserved: boolean; ordinaryAppealReopened: boolean } {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new Error(`Claim not found: ${claimId}`);
    if (claim.tenantId !== tenantId) throw new Error("Tenant scope mismatch");

    claim.exceptionalStatus = "exceptional_reopening";

    claim.history.push({
      action: "exceptional_reopening_triggered",
      timestamp: new Date().toISOString(),
      details: { reason, evidence, authorizedBy }
    });

    return {
      exceptionalStatus: "exceptional_reopening",
      recordPreserved: true,
      ordinaryAppealReopened: false // Extraordinary reopening does NOT silently reopen ordinary 7d appeal rights (ADR 0019)
    };
  }

  getAuditTrail(claimId: string, tenantId: string): DepositClaimRecord {
    const claim = this.#claims.get(claimId);
    if (!claim) throw new Error(`Claim not found: ${claimId}`);
    if (claim.tenantId !== tenantId) throw new Error("Tenant scope mismatch");
    return { ...claim };
  }
}
