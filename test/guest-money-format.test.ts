import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { A2UIServerMessage } from "@cylayo/weaver-core";
import { depositClaimArtifactToA2UI } from "../apps/web-agent/src/deposit-claim-a2ui.js";
import { pendingActionToA2UI } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import type { DepositClaimArtifact } from "../apps/web/src/deposit-claim-artifact.js";
import type { PendingAssistantAction } from "../apps/local-guest/src/assistant/pending-actions.js";

// Issue 08 (guideline §9, §10): one NGN format from kobo, and glossary labels on the pending-action and deposit-claim surfaces.

function texts(messages: readonly A2UIServerMessage[]): string[] {
  return messages
    .flatMap((message) => "updateComponents" in message ? message.updateComponents.components as readonly { readonly component: string; readonly text?: unknown }[] : [])
    .filter((component) => component.component === "Text" && typeof component.text === "string")
    .map((component) => component.text as string);
}

const claim = {
  id: "deposit-claim:r1",
  kind: "shortlet.deposit-claim",
  schema: "shortlet.deposit-claim/v1",
  projectionVersion: "v1",
  sensitivity: "booking-sensitive",
  facts: {
    reservationId: "r1",
    claimVersion: 2,
    policyVersion: "p1",
    claimPolicyVersion: "cp1",
    evidenceVersion: "e1",
    depositAmountKobo: 2_000_000,
    claimedAmountKobo: 500_000,
    claimDeadlineIso: "2026-10-01T10:00:00.000Z",
    status: "response_open",
    items: [{ itemId: "i1", description: "Broken lamp", claimedAmountKobo: 500_000, evidence: [{ evidenceReferenceId: "e-1", type: "photo", capturedAt: "2026-09-30T10:00:00.000Z", classification: "guest_caused", safeDescription: "Lamp photo" }] }],
    notificationStatus: "delivered",
    responseWindowStartIso: "2026-09-29T10:00:00.000Z",
    responseWindowEndIso: "2026-10-01T10:00:00.000Z",
    guestResponse: null,
    initialApprovedAmountKobo: null,
    noClaimRefundAmountKobo: 0,
    noClaimRefundStatus: "not_applicable",
    surplusRefundAmountKobo: 250_000,
    surplusRefundStatus: "settled",
    unapprovedRefundAmountKobo: 1_250_000,
    unapprovedRefundStatus: "reconciliation_required",
    refundReconciliationKobo: 0,
    currentClaimReserveKobo: 500_000,
    approvedOperatorAwardKobo: null,
    reconciliationRequired: false,
    decision: null,
  },
  actions: [],
} as unknown as DepositClaimArtifact;

const pendingAction: PendingAssistantAction = {
  id: "pa-1",
  threadId: "g-d1a0000401",
  guestActorId: "guest-1",
  tenantId: "tenant-1",
  type: "accept_offer",
  authoritativeReferences: { stayTotalKobo: 37_000_000, refundableDepositKobo: 2_000_000 },
  summary: "Accept the offer.",
  createdAt: "2026-10-27T10:00:00.000Z",
  expiresAt: "2026-10-27T10:20:00.000Z",
  executed: false,
};

/** A builder that formats kobo with `toLocaleString` instead of `formatMoney` (the guard's failure path). */
function formatsKoboWithoutFormatMoney(source: string): boolean {
  return /(?:kobo|Kobo)[^\n;]{0,120}toLocaleString|toLocaleString[^\n;]{0,120}(?:kobo|Kobo)/.test(source);
}

test("AC1: Deposit-claim amounts use the same ₦ format as every other guest money value", () => {
  const rendered = texts(depositClaimArtifactToA2UI({ artifact: claim, surfaceId: "surface-claim" })).join("\n");
  assert.match(rendered, /₦20,000/);
  assert.match(rendered, /₦5,000/);
  assert.match(rendered, /₦15,000/);
  // Failure path: no NGN prefix and no two-decimal kobo rendering remain.
  assert.doesNotMatch(rendered, /NGN /);
  assert.doesNotMatch(rendered, /\.00\b/);
});

test("AC2: Deposit-claim statuses show guest words, never raw enum values", () => {
  const rendered = texts(depositClaimArtifactToA2UI({ artifact: claim, surfaceId: "surface-claim" })).join("\n");
  assert.match(rendered, /Waiting for your response/);
  assert.match(rendered, /Refunded/);
  assert.match(rendered, /Needs support review/);
  // Failure path: no domain status identifier reaches the surface.
  for (const raw of ["response_open", "reconciliation_required", "not_applicable", "settled", "validated_notification_pending"]) {
    assert.equal(rendered.includes(raw), false, raw);
  }
});

test("AC3: Pending-action surfaces use the glossary money labels", () => {
  const rendered = texts(pendingActionToA2UI({ action: pendingAction, surfaceId: "surface-action" })).join("\n");
  assert.match(rendered, /All-In Stay Total: ₦370,000/);
  assert.match(rendered, /Refundable Security Deposit: ₦20,000/);
  // Failure path: the shortened or internal labels are gone.
  assert.doesNotMatch(rendered, /(?:^|\n)Stay Total:/);
  assert.doesNotMatch(rendered, /Refundable Deposit:/);
});

test("AC4: The format-guard test fails on a builder that calls toLocaleString on kobo", () => {
  const sources = [
    ...readdirSync("apps/web-agent/src").filter((name) => name.endsWith("-a2ui.ts")).map((name) => join("apps/web-agent/src", name)),
    ...readdirSync("apps/local-guest/src/assistant").filter((name) => name.endsWith("-a2ui.ts")).map((name) => join("apps/local-guest/src/assistant", name)),
  ];
  const offenders = sources.filter((path) => formatsKoboWithoutFormatMoney(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
  // Failure path: the detector reports a kobo/toLocaleString builder and accepts formatMoney.
  assert.equal(formatsKoboWithoutFormatMoney("const text = `NGN ${(facts.amountKobo / 100).toLocaleString(\"en-NG\")}`;"), true);
  assert.equal(formatsKoboWithoutFormatMoney("const text = `Total: ${formatMoney(facts.amountKobo)}`;"), false);
});
