/**
 * Local deterministic concierge interpreter for the guest demo.
 *
 * This is deliberately NOT a production LLM. It is a small regex-based
 * interpreter sufficient for the local demo flows. It must never be labelled
 * as an AI model inside the guest product UI; the local/dev documentation is
 * the only place that explains what it is.
 */

export interface StayRequestFilters {
  readonly location: string;
  readonly neighbourhood?: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly partySize: number;
}

export type StayRequestInterpretation =
  | { readonly kind: "search"; readonly filters: StayRequestFilters }
  | { readonly kind: "clarify"; readonly missing: readonly string[]; readonly reply: string };

export interface ConciergeOptions {
  readonly demoCheckIn: string;
  /** Retained for callers that supplied the old fixed-date option; ignored. */
  readonly demoCheckOut?: string;
}

const LOCATION_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly city: string;
  readonly neighbourhood?: string;
}[] = [
  { pattern: /\b(ikoyi|old ikoyi)\b/i, city: "Lagos", neighbourhood: "Old Ikoyi" },
  { pattern: /\b(lekki|lekki phase 1)\b/i, city: "Lagos", neighbourhood: "Lekki Phase 1" },
  { pattern: /\b(victoria island|vi)\b/i, city: "Lagos", neighbourhood: "Victoria Island" },
  { pattern: /\b(lagos)\b/i, city: "Lagos" },
];

const NIGHTS_PATTERN = /\b(\d{1,2})\s*(?:nights?|nitesc?|nts?)\b/i;
const GUESTS_PATTERN = /\b(\d{1,2})\s*(?:people|persons?|guests?|adults?|pax)\b/i;

function addCalendarDays(dateIso: string, nights: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new TypeError("demoCheckIn must be an ISO calendar date");
  date.setUTCDate(date.getUTCDate() + nights);
  return date.toISOString().slice(0, 10);
}

export function interpretStayRequest(text: string, options: ConciergeOptions): StayRequestInterpretation {
  const normalized = text.trim();

  const location = LOCATION_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  const nightsMatch = NIGHTS_PATTERN.exec(normalized);
  const guestsMatch = GUESTS_PATTERN.exec(normalized);

  const missing: string[] = [];
  if (!location) missing.push("where you want to stay (for example: Ikoyi or Lekki, Lagos)");
  const nights = nightsMatch ? Number.parseInt(nightsMatch[1] ?? "0", 10) : NaN;
  if (Number.isNaN(nights) || nights < 1) missing.push("how many nights you need");
  const partySize = guestsMatch ? Math.max(1, Number.parseInt(guestsMatch[1] ?? "1", 10)) : 1;
  if (!guestsMatch) missing.push("how many guests are staying");

  if (missing.length > 0 || !location) {
    return {
      kind: "clarify",
      missing,
      reply:
        "I can help you find a place. " +
        (missing.length === 1
          ? `Could you tell me ${missing[0]}?`
          : `Could you tell me ${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}?`),
    };
  }

  return {
    kind: "search",
    filters: {
      location: location.city,
      ...(location.neighbourhood ? { neighbourhood: location.neighbourhood } : {}),
      checkIn: options.demoCheckIn,
      checkOut: addCalendarDays(options.demoCheckIn, nights),
      partySize,
    },
  };
}
