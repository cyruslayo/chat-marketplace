import type { DiscoveryArtifactProjection } from "../../../apps/web-agent/src/index.js";
import { parseDiscoverySearchContext, type DiscoverySearchContext } from "./concierge.js";

/**
 * Server-owned durable interaction projection for one Guest thread (ADR-0070,
 * ADR-0071, ADR-0074, ADR-0075, ADR-0079).
 *
 * Only what is required to restore an active journey after an application
 * restart is stored: the transcript, the accumulated discovery search context,
 * the workflow aggregate ids, the current server-owned stage, discovery
 * correlation and the draft quote facts. A2UI messages, Weaver/agent model
 * history, browser-local UI state and Guest draft free-text input are never
 * stored here.
 */
export interface GuestPersistentProjection {
  readonly version: 1;
  readonly timeline: readonly { readonly role: "assistant" | "user" | "receipt"; readonly text: string }[];
  /** Accumulated conversational discovery context (ADR-0004, ADR-0074). */
  readonly discoveryContext: DiscoverySearchContext | null;
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
  /**
   * Issue 03a: the criteria of each executed search, oldest first; the last
   * is the current results' criteria. "Undo last change" steps back one.
   */
  readonly searchHistory: readonly DiscoverySearchContext[];
  /** Minimal Shortlet assistant state needed to re-authorize a cold-start follow-up. */
  readonly assistantContext: PersistedAssistantContext | null;
}

export interface PersistedAssistantContext {
  readonly city: "Lagos" | "Abuja";
  readonly neighbourhood?: string;
  readonly checkIn?: string;
  /** Provenance for the server-selected fallback date; absent means unknown. */
  readonly isDemoDate?: boolean;
  readonly checkOut?: string;
  readonly nights?: number;
  readonly partySize?: number;
  readonly bedrooms?: number;
  readonly maxBudgetKobo?: number;
  readonly requiredAmenities?: readonly string[];
  readonly selectedUnitId?: string;
}

export function isPersistentTimelineEntry(value: unknown): value is { readonly role: "assistant" | "user" | "receipt"; readonly text: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (record.role === "assistant" || record.role === "user" || record.role === "receipt") && typeof record.text === "string";
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

function parseAssistantContext(value: unknown): PersistedAssistantContext | null {
  if (!isRecord(value) || (value.city !== "Lagos" && value.city !== "Abuja")) return null;
  const allowed = new Set(["city", "neighbourhood", "checkIn", "isDemoDate", "checkOut", "nights", "partySize", "bedrooms", "maxBudgetKobo", "requiredAmenities", "selectedUnitId"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  if (value.neighbourhood !== undefined && (typeof value.neighbourhood !== "string" || value.neighbourhood.length > 100)) return null;
  if (value.isDemoDate !== undefined && typeof value.isDemoDate !== "boolean") return null;
  for (const key of ["checkIn", "checkOut"] as const) {
    const candidate = value[key];
    if (candidate !== undefined && (typeof candidate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(candidate) || Number.isNaN(Date.parse(`${candidate}T00:00:00Z`)))) return null;
  }
  for (const key of ["nights", "partySize", "bedrooms", "maxBudgetKobo"] as const) {
    const candidate = value[key];
    if (candidate !== undefined && (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < (key === "bedrooms" ? 0 : key === "maxBudgetKobo" ? 0 : 1))) return null;
  }
  if (value.requiredAmenities !== undefined && (!Array.isArray(value.requiredAmenities) || value.requiredAmenities.length > 16 || !value.requiredAmenities.every((entry) => typeof entry === "string" && /^[A-Za-z0-9_-]{1,48}$/.test(entry)))) return null;
  if (value.selectedUnitId !== undefined && (typeof value.selectedUnitId !== "string" || value.selectedUnitId.length < 1 || value.selectedUnitId.length > 128)) return null;
  return {
    city: value.city,
    ...(typeof value.neighbourhood === "string" ? { neighbourhood: value.neighbourhood } : {}),
    ...(typeof value.checkIn === "string" ? { checkIn: value.checkIn } : {}),
    ...(typeof value.isDemoDate === "boolean" ? { isDemoDate: value.isDemoDate } : {}),
    ...(typeof value.checkOut === "string" ? { checkOut: value.checkOut } : {}),
    ...(typeof value.nights === "number" ? { nights: value.nights } : {}),
    ...(typeof value.partySize === "number" ? { partySize: value.partySize } : {}),
    ...(typeof value.bedrooms === "number" ? { bedrooms: value.bedrooms } : {}),
    ...(typeof value.maxBudgetKobo === "number" ? { maxBudgetKobo: value.maxBudgetKobo } : {}),
    ...(Array.isArray(value.requiredAmenities) ? { requiredAmenities: [...value.requiredAmenities] as string[] } : {}),
    ...(typeof value.selectedUnitId === "string" ? { selectedUnitId: value.selectedUnitId } : {}),
  };
}

function optionalField<T>(value: unknown, parse: (candidate: unknown) => T | null): { readonly valid: boolean; readonly value: T | null } {
  if (value === null) return { valid: true, value: null };
  // A missing key is not the same as an explicit null: an incomplete durable
  // projection fails closed rather than being reinterpreted.
  if (value === undefined) return { valid: false, value: null };
  const parsed = parse(value);
  return parsed === null ? { valid: false, value: null } : { valid: true, value: parsed };
}

function isDiscoveryArtifact(value: unknown): DiscoveryArtifactProjection | null {
  // SAFETY: this projection is only ever written from an authoritative
  // DiscoveryArtifact, and restoration re-derives domain state rather than
  // replaying a command, so a shallow object check is the intended boundary.
  return isRecord(value) ? value as unknown as DiscoveryArtifactProjection : null;
}

function asUnitDetail(value: unknown): { readonly unitId: string; readonly artifactId: string } | null {
  return isUnitDetail(value) ? value : null;
}

function asDraftQuote(value: unknown): { readonly allInStayTotalKobo: number; readonly refundableSecurityDepositKobo: number; readonly amountDueNowKobo: number } | null {
  return isDraftQuote(value) ? value : null;
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
  const discoveryContext = parseDiscoverySearchContext(value.discoveryContext);
  if (value.discoveryContext !== undefined && value.discoveryContext !== null && discoveryContext === null) return null;
  const artifact = optionalField(value.discoveryArtifact, isDiscoveryArtifact);
  if (!artifact.valid) return null;
  const unitDetail = optionalField(value.unitDetail, asUnitDetail);
  if (!unitDetail.valid) return null;
  const draftQuote = optionalField(value.draftQuote, asDraftQuote);
  if (!draftQuote.valid) return null;
  // Projections stored before issue 03a have no history; that is an empty one.
  if (value.searchHistory !== undefined && !Array.isArray(value.searchHistory)) return null;
  const parsedHistory = ((value.searchHistory ?? []) as readonly unknown[]).map(parseDiscoverySearchContext);
  if (parsedHistory.some((entry) => entry === null)) return null;
  const assistantContextResult = optionalField(value.assistantContext ?? null, parseAssistantContext);
  if (!assistantContextResult.valid) return null;
  return Object.freeze({
    version: 1,
    timeline: Object.freeze(value.timeline.map((entry) => Object.freeze({ role: entry.role, text: entry.text }))),
    discoveryContext,
    discoveryArtifact: artifact.value === null ? null : structuredClone(artifact.value),
    discoverySurfaceId: value.discoverySurfaceId,
    discoveryRevision: value.discoveryRevision,
    unitDetail: unitDetail.value === null ? null : Object.freeze({ ...unitDetail.value }),
    draftId: value.draftId,
    draftQuote: draftQuote.value === null ? null : Object.freeze({ ...draftQuote.value }),
    requestId: value.requestId,
    offerId: value.offerId,
    activeStage: value.activeStage,
    activeSurfaceId: value.activeSurfaceId,
    searchHistory: Object.freeze(parsedHistory.filter((entry): entry is DiscoverySearchContext => entry !== null)),
    assistantContext: assistantContextResult.value,
  });
}
