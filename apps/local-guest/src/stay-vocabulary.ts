/**
 * The closed stay vocabulary shared by the deterministic concierge and the assistant's shortlet pack (issue 08, ADR 0099: the
 * shortlet side, never the domain-neutral runtime; ADR 0106: closed lists for tool values).
 *
 * - `AMENITY_ALIASES`: a guest's words for a facility, mapped to catalogue ids (the facility answers and search filters).
 * - `STAY_LOCATION_ALIASES`: the Lagos and Abuja place names the concierge understands.
 * - `SEARCH_AREAS`: the closed area list the criteria strip, the search form and the assistant's area check share.
 *
 * The catalogue ids come from `GUEST_AMENITY_IDS` (apps/web-agent guest-content): that list is the one amenity catalogue.
 */

import { GUEST_AMENITY_IDS } from "../../web-agent/src/guest-content.js";

export interface AmenityAlias {
  readonly pattern: RegExp;
  readonly label: string;
  /** Catalogue ids, most specific first. Empty when the catalogue never lists the amenity (gym, kitchen, balcony). */
  readonly ids: readonly string[];
  /** Issue 09: the label the deterministic concierge's unsupported-preference note uses (concierge.ts UNSUPPORTED_PREFERENCES). */
  readonly unsupportedLabel?: string;
}

// Questions about a Unit's facilities, answered only from `unit.amenities`
// (issue 04a AC2). An entry without ids is never listed by the catalogue, so
// the answer is always that it isn't listed.
export const AMENITY_ALIASES: readonly AmenityAlias[] = [
  { pattern: /\bparking\b/i, label: "Parking", ids: ["parking"] },
  { pattern: /\b(?:swimming\s+)?pool\b/i, label: "A pool", ids: ["swimming_pool"] },
  { pattern: /\b(?:wi-?fi|internet)\b/i, label: "Wi-Fi", ids: ["wifi"] },
  { pattern: /\b(?:generator|backup power|24\/7 power|light|power)\b/i, label: "Backup power", ids: ["24_7_power_generator", "generator"] },
  { pattern: /\b(?:security|guards?)\b/i, label: "On-site security", ids: ["security_guard"] },
  { pattern: /\b(?:air[- ]?con(?:ditioning)?|a\/c|ac)\b/i, label: "Air conditioning", ids: ["air_conditioning"] },
  { pattern: /\b(?:workspace|desk)\b/i, label: "A workspace", ids: ["workspace"] },
  { pattern: /\bgym\b/i, label: "A gym", ids: [], unsupportedLabel: "gym" },
  { pattern: /\bkitchen\b/i, label: "A kitchen", ids: [], unsupportedLabel: "kitchen" },
  { pattern: /\bbalcony\b/i, label: "A balcony", ids: [], unsupportedLabel: "balcony" },
];

/** The closed amenity catalogue (ADR 0106): the only ids a search filter may name. */
export const AMENITY_CATALOGUE_IDS: readonly string[] = GUEST_AMENITY_IDS;

/**
 * The one id a search filters by for a guest's word, or `[]` when the catalogue never lists the amenity, or `undefined` when
 * the word is unknown or names more than one amenity (fail closed: the caller leaves it for the closed schema to refuse).
 */
export function searchAmenityIdsFor(word: string): readonly string[] | undefined {
  const value = word.trim();
  if (value === "") return undefined;
  const matches = AMENITY_ALIASES.filter((alias) => alias.pattern.test(value));
  if (matches.length > 0) {
    const primaries = new Set(matches.map((alias) => alias.ids[0] ?? ""));
    if (primaries.size !== 1) return undefined;
    const [primary] = [...primaries];
    return primary === "" ? [] : [primary!];
  }
  return AMENITY_CATALOGUE_IDS.includes(value) ? [value] : undefined;
}

/**
 * Issue 09 (ADR 0080): the note label for a guest's word the catalogue never lists (gym, kitchen, balcony), or `undefined` when the word
 * is listed, unknown or ambiguous. Used on the model's own argument values, never on guest text.
 */
export function unsupportedAmenityLabelFor(word: string): string | undefined {
  const value = word.trim();
  if (value === "") return undefined;
  const matches = AMENITY_ALIASES.filter((alias) => alias.pattern.test(value));
  if (matches.length !== 1) return undefined;
  const [only] = matches;
  return only!.ids.length === 0 ? only!.unsupportedLabel : undefined;
}

/**
 * Maps a model's requiredAmenities entries to catalogue ids. A known word becomes its id (or is dropped when the catalogue never
 * lists it); any other entry is kept unchanged so the closed schema rejects it. Duplicates are removed.
 */
export function normalizeRequiredAmenities(entries: readonly unknown[]): unknown[] {
  const normalized: unknown[] = [];
  for (const entry of entries) {
    const ids = typeof entry === "string" ? searchAmenityIdsFor(entry) : undefined;
    const values = ids ?? [entry];
    for (const value of values) {
      if (!normalized.includes(value)) normalized.push(value);
    }
  }
  return normalized;
}

export const STAY_LOCATION_ALIASES: readonly {
  readonly pattern: RegExp;
  readonly city: string;
  readonly neighbourhood?: string;
}[] = [
  { pattern: /\b(wuse\s*2|wuse\s*ii|wuse\s+two)\b/i, city: "Abuja", neighbourhood: "Wuse 2" },
  // Abuja/Wuse knowledge: a bare "Wuse" names the Abuja district even though
  // the accepted pilot inventory only carries the Wuse 2 neighbourhood.
  { pattern: /\bwuse\b/i, city: "Abuja" },
  { pattern: /\babuja\b/i, city: "Abuja" },
  { pattern: /\b(ikoyi|old ikoyi)\b/i, city: "Lagos", neighbourhood: "Old Ikoyi" },
  { pattern: /\b(lekki|lekki phase 1)\b/i, city: "Lagos", neighbourhood: "Lekki Phase 1" },
  { pattern: /\b(victoria island|vi)\b/i, city: "Lagos", neighbourhood: "Victoria Island" },
  { pattern: /\b(lagos)\b/i, city: "Lagos" },
];

/**
 * The areas a Guest can pick on the criteria strip and on the conventional search form (ADR-0080). They are the locations the
 * concierge already understands in free text; no new inventory area is invented here.
 */
export const SEARCH_AREAS: readonly { readonly id: string; readonly label: string; readonly city: string; readonly neighbourhood?: string }[] = Object.freeze([
  { id: "abuja", label: "Abuja (all areas)", city: "Abuja" },
  { id: "wuse-2", label: "Wuse 2, Abuja", city: "Abuja", neighbourhood: "Wuse 2" },
  { id: "lagos", label: "Lagos (all areas)", city: "Lagos" },
  { id: "old-ikoyi", label: "Old Ikoyi, Lagos", city: "Lagos", neighbourhood: "Old Ikoyi" },
  { id: "lekki-phase-1", label: "Lekki Phase 1, Lagos", city: "Lagos", neighbourhood: "Lekki Phase 1" },
  { id: "victoria-island", label: "Victoria Island, Lagos", city: "Lagos", neighbourhood: "Victoria Island" },
]);
