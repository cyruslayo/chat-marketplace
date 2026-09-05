import type { DiscoveryArtifactProjection } from "../../../apps/web-agent/src/index.js";

/**
 * Server-owned durable interaction projection for one Guest thread (ADR-0070,
 * ADR-0071, ADR-0074, ADR-0075, ADR-0079).
 *
 * Only what is required to restore an active journey after an application
 * restart is stored: the transcript, the workflow aggregate ids, the current
 * server-owned stage, discovery correlation and the draft quote facts. A2UI
 * messages, Weaver/agent model history, browser-local UI state and Guest draft
 * free-text input are never stored here.
 */
export interface GuestPersistentProjection {
  readonly version: 1;
  readonly timeline: readonly { readonly role: "assistant" | "user"; readonly text: string }[];
  readonly discoveryArtifact: DiscoveryArtifactProjection | null;
  readonly discoverySurfaceId: string;
  readonly discoveryRevision: number;
  readonly unitDetail: { readonly unitId: string; readonly artifactId: string } | null;
  readonly draftId: string | null;
  readonly draftQuote: { readonly allInStayTotalKobo: number; readonly refundableSecurityDepositKobo: number; readonly amountDueNowKobo: number } | null;
  readonly requestId: string | null;
  readonly offerId: string | null;
  readonly activeStage: string | null;
  readonly activeSurfaceId: string | null;
}

export function isPersistentTimelineEntry(value: unknown): value is { readonly role: "assistant" | "user"; readonly text: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (record.role === "assistant" || record.role === "user") && typeof record.text === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDraftQuote(value: unknown): value is { readonly allInStayTotalKobo: number; readonly refundableSecurityDepositKobo: number; readonly amountDueNowKobo: number } {
  return isRecord(value)
    && typeof value.allInStayTotalKobo === "number"
    && typeof value.refundableSecurityDepositKobo === "number"
    && typeof value.amountDueNowKobo === "number";
}

function isUnitDetail(value: unknown): value is { readonly unitId: string; readonly artifactId: string } {
  return isRecord(value) && typeof value.unitId === "string" && typeof value.artifactId === "string";
}

/**
 * Validates an unknown decoded projection. Invalid or unsupported projections
 * fail closed (null) so a corrupt store can never start a workflow or replay a
 * command.
 */
export function parseGuestProjection(value: unknown): GuestPersistentProjection | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (!Array.isArray(value.timeline) || !value.timeline.every(isPersistentTimelineEntry)) return null;
  if (typeof value.discoverySurfaceId !== "string") return null;
  if (typeof value.discoveryRevision !== "number" || !Number.isInteger(value.discoveryRevision) || value.discoveryRevision < 0) return null;
  const nullableString = (candidate: unknown): candidate is string | null => candidate === null || typeof candidate === "string";
  if (!nullableString(value.draftId) || !nullableString(value.requestId) || !nullableString(value.offerId)) return null;
  if (!nullableString(value.activeStage) || !nullableString(value.activeSurfaceId)) return null;
  const discoveryArtifact = value.discoveryArtifact === null ? null : isRecord(value.discoveryArtifact) ? value.discoveryArtifact as unknown as DiscoveryArtifactProjection : null;
  if (value.discoveryArtifact !== null && discoveryArtifact === null) return null;
  const unitDetail = value.unitDetail === null ? null : isUnitDetail(value.unitDetail) ? value.unitDetail : null;
  if (value.unitDetail !== null && unitDetail === null) return null;
  const draftQuote = value.draftQuote === null ? null : isDraftQuote(value.draftQuote) ? value.draftQuote : null;
  if (value.draftQuote !== null && draftQuote === null) return null;
  return Object.freeze({
    version: 1,
    timeline: Object.freeze(value.timeline.map((entry) => Object.freeze({ role: entry.role, text: entry.text }))),
    discoveryArtifact: discoveryArtifact ? structuredClone(discoveryArtifact) : null,
    discoverySurfaceId: value.discoverySurfaceId,
    discoveryRevision: value.discoveryRevision,
    unitDetail: unitDetail ? Object.freeze({ ...unitDetail }) : null,
    draftId: value.draftId,
    draftQuote: draftQuote ? Object.freeze({ ...draftQuote }) : null,
    requestId: value.requestId,
    offerId: value.offerId,
    activeStage: value.activeStage,
    activeSurfaceId: value.activeSurfaceId,
  });
}
