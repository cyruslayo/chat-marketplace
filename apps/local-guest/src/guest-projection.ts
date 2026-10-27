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
  /**
   * ADR 0106: the server-issued id of the discovery artifact the guest holds. A cold restore re-queries current facts
   * but keeps this id, so the card's View action still names the shell's authoritative artifact. Absent in projections
   * written before this field existed, which read as null.
   */
  readonly discoveryArtifactId: string | null;
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
  /**
   * The open contact-details surface (phone or email) and the non-secret ids its Save action resumes with. A cold restore
   * re-renders this same surface, so the guest's Save stays authorized. Missing in older projections, which read as null.
   */
  readonly activeContact: PersistedActiveContact | null;
}

export interface PersistedActiveContact {
  readonly surfaceId: string;
  readonly kind: "phone" | "email";
  readonly resumeContext: Readonly<Record<string, string | number | boolean>>;
}

function parseActiveContact(value: unknown): PersistedActiveContact | null {
  if (!isRecord(value)) return null;
  if (typeof value.surfaceId !== "string" || value.surfaceId === "" || value.surfaceId.length > 300) return null;
  if (value.kind !== "phone" && value.kind !== "email") return null;
  if (!isRecord(value.resumeContext)) return null;
  const resumeContext: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value.resumeContext)) {
    // Contact values and revisions are never part of the resume context (ADR 0093, 0075).
    if (key === "contactValue" || key === "expectedRevision" || key.length > 64) return null;
    if (typeof entry === "string") {
      if (entry.length > 200) return null;
      resumeContext[key] = entry;
    } else if (typeof entry === "number" || typeof entry === "boolean") {
      resumeContext[key] = entry;
    } else return null;
  }
  return { surfaceId: value.surfaceId, kind: value.kind, resumeContext };
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
  const discoveryArtifactId = value.discoveryArtifactId === undefined ? null : value.discoveryArtifactId;
  if (!nullableString(discoveryArtifactId) || discoveryArtifactId?.trim() === "" || (discoveryArtifactId?.length ?? 0) > 200) return null;
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
  // Missing in projections written before this field existed; a present but malformed value fails closed.
  if (value.activeContact !== undefined && value.activeContact !== null && parseActiveContact(value.activeContact) === null) return null;
  const activeContact = value.activeContact === undefined || value.activeContact === null ? null : parseActiveContact(value.activeContact);
  return Object.freeze({
    activeContact,
    version: 1,
    timeline: Object.freeze(value.timeline.map((entry) => Object.freeze({ role: entry.role, text: entry.text }))),
    discoveryContext,
    discoveryArtifact: artifact.value === null ? null : structuredClone(artifact.value),
    discoveryArtifactId,
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
