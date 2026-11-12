import { A2UI_V091_BASIC_CATALOG_ID, type A2UIComponent, type A2UIServerMessage } from "@cylayo/weaver-core";
import type { DepositClaimArtifact } from "../../web/src/deposit-claim-artifact.js";
import { EVENTS } from "../../web/src/deposit-claim-actions.js";
import { formatMoney } from "../../web/src/ui-kit.js";
import { GUEST_DEPOSIT_CLAIM_COPY, GUEST_GLOSSARY } from "./guest-content.js";

function wat(iso: string | null): string {
  return iso ? `${new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })} WAT` : "Not started";
}

/** Issue 08 (guideline §9, §10): guest words and the one NGN format; no raw domain state or kobo arithmetic here. */
export function depositClaimArtifactToA2UI({ artifact, surfaceId }: { readonly artifact: DepositClaimArtifact; readonly surfaceId: string }): readonly A2UIServerMessage[] {
  const f = artifact.facts;
  const itemText = f.items
    .map((item) => `${item.description}: ${formatMoney(item.claimedAmountKobo)} (${item.evidence.map((evidence) => `${evidence.type}, ${evidence.safeDescription}`).join("; ")})`)
    .join("; ");
  const refundText = f.claimedAmountKobo === 0
    ? `No Security Deposit Claim was filed in time. ${GUEST_GLOSSARY.refundableSecurityDeposit}: ${formatMoney(f.noClaimRefundAmountKobo)}. Refund: ${GUEST_DEPOSIT_CLAIM_COPY.refundStatus(f.noClaimRefundStatus)}. Reserved for Operator: ${formatMoney(0)}.`
    : `Returning to guest: ${formatMoney(f.surplusRefundAmountKobo + f.unapprovedRefundAmountKobo)} (surplus ${GUEST_DEPOSIT_CLAIM_COPY.refundStatus(f.surplusRefundStatus)}; unapproved ${GUEST_DEPOSIT_CLAIM_COPY.refundStatus(f.unapprovedRefundStatus)}). Reserved for review: ${formatMoney(f.currentClaimReserveKobo)}.`;
  const statusText = `${GUEST_DEPOSIT_CLAIM_COPY.status(f.status)}${f.guestResponse ? `; ${GUEST_DEPOSIT_CLAIM_COPY.response(f.guestResponse)}` : ""}${f.decision ? `; reviewed decision proposes ${formatMoney(f.decision.proposedApprovedKobo)}` : ""}${f.reconciliationRequired ? "; refund reconciliation requires support." : ""}`;
  const components: A2UIComponent[] = [
    {
      id: "deposit-claim-root",
      component: "Column",
      children: ["deposit-claim-title", "deposit-claim-summary", "deposit-claim-deadlines", "deposit-claim-items", "deposit-claim-refunds", "deposit-claim-status", "deposit-claim-actions"],
    },
    { id: "deposit-claim-title", component: "Text", text: GUEST_DEPOSIT_CLAIM_COPY.title, variant: "h2" },
    { id: "deposit-claim-summary", component: "Text", text: `Held deposit: ${formatMoney(f.depositAmountKobo)}. Validated claim: ${formatMoney(f.claimedAmountKobo)}.` },
    { id: "deposit-claim-deadlines", component: "Text", text: `Claim deadline: ${wat(f.claimDeadlineIso)}. Response deadline: ${wat(f.responseWindowEndIso)}. Appeal deadline: ${f.appealDeadlineWAT ?? "Not started"}.` },
    { id: "deposit-claim-items", component: "Text", text: itemText || "No claim was submitted; the full deposit is returning to the guest." },
    { id: "deposit-claim-refunds", component: "Text", text: refundText },
    { id: "deposit-claim-status", component: "Text", text: statusText },
    { id: "deposit-claim-actions", component: "Column", children: artifact.actions.map((action) => `deposit-action-${action.type}`) },
    ...artifact.actions.flatMap((action): A2UIComponent[] => [
      {
        id: `deposit-action-${action.type}`,
        component: "Button",
        child: `deposit-label-${action.type}`,
        variant: action.type === "dispute" ? "secondary" : "primary",
        action: {
          event: {
            name: EVENTS[action.type],
            context: {
              artifactId: action.artifactId,
              claimId: action.claimId,
              expectedClaimVersion: action.expectedClaimVersion,
              projectionVersion: action.projectionVersion,
              ...(action.decisionId ? { decisionId: action.decisionId } : {}),
              ...(action.decisionVersion ? { decisionVersion: action.decisionVersion } : {}),
              ...(action.evidenceVersion ? { evidenceVersion: action.evidenceVersion } : {}),
              ...(action.policyVersion ? { policyVersion: action.policyVersion } : {}),
            },
          },
        },
      },
      {
        id: `deposit-label-${action.type}`,
        component: "Text",
        text: action.type === "accept" ? "Accept this claim (reserved amount remains under review)" : action.type === "dispute" ? "Dispute this claim" : "Apply reviewed human decision",
      },
    ]),
  ];
  return Object.freeze([
    { version: "v0.9.1", createSurface: { surfaceId, catalogId: A2UI_V091_BASIC_CATALOG_ID } },
    { version: "v0.9.1", updateComponents: { surfaceId, components } },
  ]);
}
