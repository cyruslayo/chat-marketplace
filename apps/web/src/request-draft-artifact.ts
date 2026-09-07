import type { CommandPrincipal } from "../../../packages/platform-core/src/index.js";

export const REQUEST_DRAFT_ARTIFACT_KIND = "shortlet.request-draft";
export const REQUEST_DRAFT_SCHEMA_VERSION = "shortlet.request-draft/v1";

export type RequestDraftActionType = "review" | "submit";

export interface RequestDraftArtifactAction {
  readonly type: RequestDraftActionType;
  readonly artifactId: string;
  readonly draftId: string;
  readonly expectedStatus: "draft";
  readonly projectionVersion: number;
}

export interface RequestDraftArtifact {
  readonly id: string;
  readonly kind: typeof REQUEST_DRAFT_ARTIFACT_KIND;
  readonly schemaVersion: typeof REQUEST_DRAFT_SCHEMA_VERSION;
  readonly projectionVersion: number;
  readonly domainReferences: readonly { readonly type: "request-draft" | "unit"; readonly id: string }[];
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly disclosures: readonly string[];
  readonly facts: {
    readonly draftId: string;
    readonly unitId: string;
    readonly unitTitle: string;
    readonly operatorName: string;
    readonly checkIn: string;
    readonly checkOut: string;
    readonly nights: number;
    readonly primaryGuestName: string;
    readonly occupants: readonly string[];
    readonly currency: "NGN";
    readonly allInStayTotalKobo: number;
    readonly refundableSecurityDepositKobo: number;
    readonly amountDueNowKobo: number;
    readonly cancellationPolicy: { readonly type: string; readonly version: string; readonly summary: string };
    readonly inventoryReserved: false;
  };
  readonly actions: readonly RequestDraftArtifactAction[];
  readonly acknowledgements: readonly string[];
  readonly sensitivity: "booking-sensitive";
}

export interface RequestDraftProjectionInput {
  readonly draftId: string;
  readonly unitId: string;
  readonly unitTitle: string;
  readonly operatorName: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly primaryGuestName: string;
  readonly occupants: readonly string[];
  readonly allInStayTotalKobo: number;
  readonly refundableSecurityDepositKobo: number;
  readonly amountDueNowKobo: number;
  readonly cancellationPolicy: { readonly type: string; readonly version: string; readonly summary: string };
  readonly view: "draft" | "review";
  readonly policyVersions?: Readonly<Record<string, string>>;
  readonly disclosures?: readonly string[];
}

export function requestDraftArtifactId(draftId: string): string {
  return `request-draft:${draftId}`;
}

export function requestDraftArtifactFromProjection(input: RequestDraftProjectionInput, viewer: CommandPrincipal): RequestDraftArtifact {
  const id = requestDraftArtifactId(input.draftId);
  const canReview = viewer.role === "guest" && viewer.id !== "";
  const canSubmit = canReview;
  const actionType: RequestDraftActionType = input.view === "review" ? "submit" : "review";
  const actions = (actionType === "review" ? canReview : canSubmit) ? [{ type: actionType, artifactId: id, draftId: input.draftId, expectedStatus: "draft" as const, projectionVersion: 1 }] : [];
  return Object.freeze({
    id,
    kind: REQUEST_DRAFT_ARTIFACT_KIND,
    schemaVersion: REQUEST_DRAFT_SCHEMA_VERSION,
    projectionVersion: 1,
    domainReferences: Object.freeze([
      Object.freeze({ type: "request-draft" as const, id: input.draftId }),
      Object.freeze({ type: "unit" as const, id: input.unitId }),
    ]),
    policyVersions: Object.freeze({ ...(input.policyVersions ?? {}) }),
    disclosures: Object.freeze([...(input.disclosures ?? [])]),
    facts: Object.freeze({
      draftId: input.draftId,
      unitId: input.unitId,
      unitTitle: input.unitTitle,
      operatorName: input.operatorName,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights: input.nights,
      primaryGuestName: input.primaryGuestName,
      occupants: Object.freeze([...input.occupants]),
      currency: "NGN" as const,
      allInStayTotalKobo: input.allInStayTotalKobo,
      refundableSecurityDepositKobo: input.refundableSecurityDepositKobo,
      amountDueNowKobo: input.amountDueNowKobo,
      cancellationPolicy: Object.freeze({ ...input.cancellationPolicy }),
      inventoryReserved: false as const,
    }),
    actions: Object.freeze(actions.map((action) => Object.freeze(action))),
    acknowledgements: Object.freeze([]),
    sensitivity: "booking-sensitive" as const,
  });
}
