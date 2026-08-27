import test from "node:test";
import assert from "node:assert/strict";
import { setupIssue27AuthorityCase } from "./support/issue27-fixture.js";

const operator = { id: "operator-27", role: "operator" as const, tenantId: "tenant-27" };
const system = { id: "system-27", role: "system" as const, tenantId: "tenant-27" };
const appeal = { ground: "calculation_error" as const, statement: "The calculation is wrong.", evidenceReferenceIds: ["trusted-evidence-1"] };

function bothReceipts() {
  const s = setupIssue27AuthorityCase();
  s.app.recordDecisionNotice(s.claimId, "guest", system);
  s.setNow("2026-09-05T10:00:00.000Z");
  s.setDelivery("operator", "2026-09-05T10:00:00.000Z");
  s.app.recordDecisionNotice(s.claimId, "operator", system);
  return s;
}

test("Issue 27 stores independent Guest and Operator receipt windows and uses the caller party window", () => {
  const s = bothReceipts();
  const guestView = s.artifact("guest");
  const operatorView = s.artifact("operator");
  assert.equal(guestView.facts.decisionReceipt?.appealWindowEndsAtIso, "2026-09-10T10:00:00.000Z");
  assert.equal(operatorView.facts.decisionReceipt?.appealWindowEndsAtIso, "2026-09-12T10:00:00.000Z"); assert.match(guestView.facts.appealDeadlineWAT ?? "", /WAT/); assert.match(operatorView.facts.appealDeadlineWAT ?? "", /WAT/);
  s.setNow("2026-09-11T10:00:00.000Z");
  assert.throws(() => s.app.fileAppeal(s.claimId, "guest", { id: "guest-27", role: "guest", tenantId: "tenant-27" }, appeal), /LATE_APPEAL/);
  assert.equal(s.app.fileAppeal(s.claimId, "operator", operator, appeal).appeals?.[0].appellantParty, "operator");
});

test("Issue 27 preserves the earliest authenticated receipt and rejects malformed, pre-decision, and future delivery timestamps", () => {
  const direct = setupIssue27AuthorityCase();
  direct.setNow("2026-09-03T11:00:00.000Z");
  direct.app.recordDecisionViewed(direct.claimId, "guest", { id: "guest-27", role: "guest", tenantId: "tenant-27" });
  direct.setDelivery("guest", "2026-09-04T11:00:00.000Z");
  direct.setNow("2026-09-04T11:00:00.000Z");
  const deliveredAfterView = direct.app.recordDecisionNotice(direct.claimId, "guest", system);
  assert.equal(deliveredAfterView.decisionNotices?.[0].receiptSource, "direct_view");
  assert.equal(direct.app.recordDecisionViewed(direct.claimId, "guest", { id: "guest-27", role: "guest", tenantId: "tenant-27" }).claimVersion, deliveredAfterView.claimVersion);
  for (const timestamp of ["not-an-iso", "2026-09-02T10:00:00.000Z", "2026-09-04T10:00:00.001Z"]) {
    const s = setupIssue27AuthorityCase();
    s.setDelivery("guest", timestamp);
    const before = s.claims.findByClaimId(s.claimId)!;
    assert.throws(() => s.app.recordDecisionNotice(s.claimId, "guest", system), /Invalid decision delivery time/);
    assert.equal(s.claims.findByClaimId(s.claimId)!.claimVersion, before.claimVersion);
  }
});

test("Issue 27 accepts inclusive seven-day boundaries independently for Guest and Operator", () => { for (const party of ["guest", "operator"] as const) { const early = setupIssue27AuthorityCase(); early.app.recordDecisionNotice(early.claimId, party, system); early.setNow("2026-09-10T09:59:59.999Z"); assert.equal(early.app.fileAppeal(early.claimId, party, party === "guest" ? { id: "guest-27", role: "guest", tenantId: "tenant-27" } : operator, appeal).appeals?.[0].appellantParty, party); const exact = setupIssue27AuthorityCase(); exact.app.recordDecisionNotice(exact.claimId, party, system); exact.setNow("2026-09-10T10:00:00.000Z"); assert.equal(exact.app.fileAppeal(exact.claimId, party, party === "guest" ? { id: "guest-27", role: "guest", tenantId: "tenant-27" } : operator, appeal).appeals?.[0].appellantParty, party); const late = setupIssue27AuthorityCase(); late.app.recordDecisionNotice(late.claimId, party, system); late.setNow("2026-09-10T10:00:00.001Z"); assert.throws(() => late.app.fileAppeal(late.claimId, party, party === "guest" ? { id: "guest-27", role: "guest", tenantId: "tenant-27" } : operator, appeal), /LATE_APPEAL/); } });

test("Issue 27 validates trusted evidence for every allowed appeal ground", () => {
  for (const ground of ["material_factual_error", "previously_unavailable_material_evidence", "calculation_error", "incorrect_policy_application"] as const) {
    const s = setupIssue27AuthorityCase();
    s.app.recordDecisionNotice(s.claimId, "guest", system);
    const result = s.app.fileAppeal(s.claimId, "guest", { id: "guest-27", role: "guest", tenantId: "tenant-27" }, { ...appeal, ground });
    assert.equal(result.appeals?.[0].evidenceSetId, "appeal-evidence");
    assert.equal(s.evidenceCalls(), 1);
  }
});

test("Issue 27 requires genuinely new material evidence only for the new-evidence ground", () => {
  const s = setupIssue27AuthorityCase({ newEvidence: false });
  s.app.recordDecisionNotice(s.claimId, "guest", system);
  assert.throws(() => s.app.fileAppeal(s.claimId, "guest", { id: "guest-27", role: "guest", tenantId: "tenant-27" }, { ...appeal, ground: "previously_unavailable_material_evidence" }), /evidence authority/);
});

test("Issue 27 prevents system application and original-reviewer appeal decisions before provider or accounting side effects", () => {
  const s = setupIssue27AuthorityCase();
  s.app.recordDecisionNotice(s.claimId, "guest", system);
  s.app.fileAppeal(s.claimId, "guest", { id: "guest-27", role: "guest", tenantId: "tenant-27" }, appeal);
  const before = s.claims.findByClaimId(s.claimId)!;
  assert.throws(() => s.app.applyAppealDecision(s.claimId, before.appeals![0].appealId, system, { appealVersion: 1, appealDecisionVersion: "v1" }), /ACTION_NOT_AUTHORIZED/);
  assert.equal(s.appealDecisionCalls(), 0);
  assert.equal(s.claims.findByClaimId(s.claimId)!.claimVersion, before.claimVersion);
  s.setAppealReviewer("human-27");
  assert.throws(() => s.app.applyAppealDecision(s.claimId, before.appeals![0].appealId, { id: "staff-27", role: "authorized_staff", tenantId: "tenant-27" }, { appealVersion: 1, appealDecisionVersion: "v1" }), /Invalid independent appeal decision/);
  assert.equal(s.claims.findByClaimId(s.claimId)!.adjudicationSnapshot?.approvedOperatorAwardKobo, 1_000_000);
});

test("Issue 27 keeps the original adjudication snapshot immutable while applying a reviewed reduction", () => {
  const s = setupIssue27AuthorityCase();
  s.app.recordDecisionNotice(s.claimId, "guest", system);
  s.app.fileAppeal(s.claimId, "guest", { id: "guest-27", role: "guest", tenantId: "tenant-27" }, appeal);
  const before = structuredClone(s.claims.findByClaimId(s.claimId)!.adjudicationSnapshot);
  const result = s.app.applyAppealDecision(s.claimId, s.claims.findByClaimId(s.claimId)!.appeals![0].appealId, { id: "staff-27", role: "authorized_staff", tenantId: "tenant-27" }, { appealVersion: 1, appealDecisionVersion: "v1" });
  assert.deepEqual(result.adjudicationSnapshot, before);
  assert.equal(result.approvedOperatorAwardKobo, 500_000);
  assert.equal(s.app.getRefundSummary(`${s.claimId}:appeal-adjustment:${result.appeals![0].appealId}:v1`)?.kind, "appeal-adjustment");
});

test("Issue 27 Guest waiver does not waive the unresolved Operator gate", () => {
  const s = setupIssue27AuthorityCase();
  s.app.recordDecisionNotice(s.claimId, "guest", system);
  const waived = s.app.waiveAppeal(s.claimId, { id: "guest-27", role: "guest", tenantId: "tenant-27" }, { decisionId: "decision-27", decisionVersion: "v1" });
  assert.equal(waived.finality?.guestWaivedById, "guest-27");
  assert.notEqual(waived.finality?.status, "internally_final");
  assert.equal(s.app.advanceClaimFinality(s.claimId, system).finality?.status, "appeal_window_open");
});

test("Issue 27 does not finalize at the earlier Guest deadline while the Operator window remains open", () => { const s = bothReceipts(); s.setNow("2026-09-10T10:00:00.001Z"); assert.equal(s.app.advanceClaimFinality(s.claimId, system).finality?.status, "reserved"); assert.throws(() => s.app.progressAwardPayout(s.claimId, system), /Award is not payable/); assert.equal(s.payoutCalls(), 0); });

test("Issue 27 finalizes once both party gates expire and resumes a pending award settlement", () => { const s = bothReceipts(); s.setNow("2026-09-12T10:00:00.000Z"); const final = s.app.advanceClaimFinality(s.claimId, system); assert.equal(final.finality?.status, "internally_final"); assert.equal(s.app.advanceClaimFinality(s.claimId, system).claimVersion, final.claimVersion); const pending = s.app.progressAwardPayout(s.claimId, system); assert.equal(pending.finality?.status, "payout_pending"); assert.equal(s.payoutCalls(), 1); s.setPayoutStatus("settled"); const paid = s.app.progressAwardPayout(s.claimId, system); assert.equal(paid.finality?.status, "paid"); assert.equal(s.payoutCalls(), 2); assert.equal(s.app.progressAwardPayout(s.claimId, system).claimVersion, paid.claimVersion); assert.equal(s.payoutCalls(), 2); assert.equal(s.accounting.journals().filter((journal) => journal.obligationId?.includes("operator-award")).length, 1); });

test("Issue 27 blocks whole-claim finality while an Operator appeal is pending", () => { const s = bothReceipts(); s.app.fileAppeal(s.claimId, "operator", operator, appeal); s.setNow("2026-09-12T00:00:00.000Z"); assert.equal(s.app.advanceClaimFinality(s.claimId, system).finality?.status, "appeal_pending"); assert.equal(s.payoutCalls(), 0); });

test("Issue 27 failed Guest notice runs exact Day 14, Day 45, and Day 90 milestones", () => { const s = setupIssue27AuthorityCase(); s.setDelivery("guest", undefined); s.setNow("2026-09-16T09:59:59.999Z"); assert.equal(s.app.advanceFailedNoticeTimeline(s.claimId, system).history.some((entry) => entry.action === "day14_assisted_review"), false); s.setNow("2026-09-16T10:00:00.000Z"); assert.equal(s.app.advanceFailedNoticeTimeline(s.claimId, system).history.filter((entry) => entry.action === "day14_assisted_review").length, 1); assert.equal(s.handoffs(), 1); assert.equal(s.app.advanceFailedNoticeTimeline(s.claimId, system).history.filter((entry) => entry.action === "day14_assisted_review").length, 1); s.setNow("2026-10-17T09:59:59.999Z"); assert.equal(s.app.advanceFailedNoticeTimeline(s.claimId, system).history.some((entry) => entry.action === "day45_reserve_release"), false); s.setNow("2026-10-17T10:00:00.000Z"); const released = s.app.advanceFailedNoticeTimeline(s.claimId, system); assert.equal(released.history.filter((entry) => entry.action === "day45_reserve_release").length, 1); assert.equal(s.app.getRefundSummary(`${s.claimId}:failed-notice-day45`)?.kind, "failed-notice-day45"); assert.equal(s.app.advanceFailedNoticeTimeline(s.claimId, system).history.filter((entry) => entry.action === "day45_reserve_release").length, 1); s.setNow("2026-12-01T09:59:59.999Z"); assert.notEqual(s.app.advanceFailedNoticeTimeline(s.claimId, system).finality?.status, "closed"); s.setNow("2026-12-01T10:00:00.000Z"); const closed = s.app.advanceFailedNoticeTimeline(s.claimId, system); assert.equal(closed.finality?.status, "closed"); assert.equal(s.app.advanceFailedNoticeTimeline(s.claimId, system).claimVersion, closed.claimVersion); });

void operator;
