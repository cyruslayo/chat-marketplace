import { createHash } from "node:crypto";

export const RELOCATION_ARTIFACT_KIND = "shortlet.relocation-remedy" as const;
export const RELOCATION_SCHEMA_VERSION = "shortlet.relocation-remedy/v1" as const;
export type RelocationAction = { readonly type: "choose_refund" | "choose_relocation_candidate"; readonly artifactId: string; readonly reservationId: string; readonly caseId: string; readonly expectedCaseVersion: number; readonly expectedContractVersion: number; readonly eligibilityVersion: string; readonly candidateSetVersion?: string; readonly candidateId?: string; readonly candidateVersion?: string; readonly termsVersion?: string; readonly comparabilityVersion?: string; readonly remainingStayEconomicsVersion: string; readonly transportQuoteVersion?: string; readonly approvalVersion?: string; readonly availabilityVersion?: string; readonly relocationPolicyVersion: string; readonly refundObligationVersion: string; readonly liabilityVersion?: string; readonly projectionVersion: string };
export interface RelocationArtifact { readonly id: string; readonly kind: typeof RELOCATION_ARTIFACT_KIND; readonly schema: typeof RELOCATION_SCHEMA_VERSION; readonly projectionVersion: string; readonly facts: Record<string, unknown>; readonly actions: readonly RelocationAction[]; }
export function relocationArtifactId(reservationId: string): string { return `relocation-remedy:${reservationId}`; }
export function projectRelocationArtifact(facts: Record<string, unknown>, actions: readonly RelocationAction[]): RelocationArtifact {
  const id = String(facts.caseId ? `relocation-remedy:${facts.reservationId}` : facts.reservationId);
  const marker = JSON.stringify({ facts, actions: actions.map(({ projectionVersion: _p, ...a }) => a) });
  const projectionVersion = createHash("sha256").update(marker).digest("hex");
  const bound = actions.map((action) => Object.freeze({ ...action, projectionVersion }));
  return Object.freeze({ id, kind: RELOCATION_ARTIFACT_KIND, schema: RELOCATION_SCHEMA_VERSION, projectionVersion, facts: Object.freeze(facts), actions: Object.freeze(bound) });
}
