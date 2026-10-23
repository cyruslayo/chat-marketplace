export const SMOKE_GRADING_PROFILE = "price-roles-and-status-v3";

/** Public price facts supplied by a domain projection or quote (ADR 0015). */
export interface SmokePriceFacts {
  readonly nightlyKobo?: number;
  readonly accommodationKobo?: number;
  readonly allInStayTotalKobo?: number | null;
  readonly mandatoryFeesKobo?: number;
  readonly refundableSecurityDepositKobo?: number;
  readonly amountDueNowKobo?: number | null;
}

export function authoritativePriceFacts(facts: SmokePriceFacts): SmokePriceFacts {
  return { nightlyKobo: facts.nightlyKobo, accommodationKobo: facts.accommodationKobo, allInStayTotalKobo: facts.allInStayTotalKobo,
    mandatoryFeesKobo: facts.mandatoryFeesKobo, refundableSecurityDepositKobo: facts.refundableSecurityDepositKobo,
    amountDueNowKobo: facts.amountDueNowKobo };
}

const PRICE_ROLES: readonly { readonly field: keyof SmokePriceFacts; readonly label: RegExp }[] = [
  { field: "accommodationKobo", label: /\baccommodation(?:\s+(?:cost|subtotal|total))?\b|\bsubtotal\b/gi },
  { field: "nightlyKobo", label: /\bnightly(?:\s+(?:rate|price))?\b|\bper\s+night\b|\/\s*night\b/gi },
  { field: "mandatoryFeesKobo", label: /\b(?:(?:mandatory|cleaning|service)\s+)?(?:fees?|charges?)\b/gi },
  { field: "refundableSecurityDepositKobo", label: /\b(?:refundable\s+)?(?:security\s+)?deposit\b/gi },
  { field: "allInStayTotalKobo", label: /\b(?:(?:all[- ]in|stay|grand|full)\s+)?total\b(?!\s+(?:amount\s+)?due)|\ball[- ]in(?:\s+(?:price|cost))?\b/gi },
  { field: "amountDueNowKobo", label: /\b(?:total\s+)?amount\s+due(?:\s+now)?\b|\b(?:total\s+)?due\s+now\b|\bpay(?:able)?\s+now\b/gi },
];

function priceRole(before: string, after: string): keyof SmokePriceFacts | undefined {
  // Limit label ownership to the current clause and adjacent amount, not another price in a list.
  const boundary = /[,;.!?\n]|\b(?:and|plus|with|including)\b/i;
  const prefix = before.split(boundary).at(-1) ?? "";
  const suffix = after.split(boundary)[0] ?? "";
  const candidates: { readonly field: keyof SmokePriceFacts; readonly distance: number; readonly labelLength: number }[] = [];
  for (const { field, label } of PRICE_ROLES) {
    for (const match of prefix.matchAll(label)) candidates.push({ field, distance: prefix.length - match.index - match[0].length, labelLength: match[0].length });
  }
  // A leading claim such as "total is" cannot be overwritten by a trailing fee label.
  if (candidates.length === 0) for (const { field, label } of PRICE_ROLES) {
    for (const match of suffix.matchAll(label)) candidates.push({ field, distance: match.index, labelLength: match[0].length });
  }
  candidates.sort((left, right) => left.distance - right.distance || right.labelLength - left.labelLength);
  const nearest = candidates[0];
  if (!nearest || candidates.some((candidate) => candidate.distance === nearest.distance && candidate.labelLength === nearest.labelLength && candidate.field !== nearest.field)) return undefined;
  return nearest.field;
}

function claimsCompletedAction(text: string): boolean {
  for (const clause of text.split(/[.!?;\n]+|\b(?:but|however)\b/i)) {
    let previousEnd = 0;
    const statuses = /\b(?:booked|confirmed|completed|complete|successful|reserved|secured|paid|went\s+through|gone\s+through)\b/gi;
    for (const match of clause.matchAll(statuses)) {
      const prefix = clause.slice(previousEnd, match.index);
      const suffix = clause.slice(match.index + match[0].length);
      previousEnd = match.index + match[0].length;
      const subjectBefore = /\b(?:booking|reservation|payment|stay|apartment|you)\b/i.test(prefix);
      const activeConfirmation = /^(?:confirmed|completed|reserved|secured)$/i.test(match[0]) && /^\s+(?:your|the)\s+(?:booking|reservation|payment|stay)\b/i.test(suffix);
      if (!subjectBefore && !activeConfirmation && !/^booked$/i.test(match[0])) continue;
      if (/\b(?:not|never|isn't|aren't|haven't|hasn't)(?:\s+(?:been|yet|fully|already))*\s*$/i.test(prefix)) continue;
      if (/\b(?:can|could|will|would|may|might|must|should|to)(?:\s+(?:be|been))*\s*$/i.test(prefix)) continue;
      return true;
    }
  }
  return false;
}

/** A bounded prose check, not a proof about arbitrary language. Ambiguous monetary claims fail closed.
 * Evaluate in memory; never persist model prose or matched text (ADR 0075).
 */
export function hasUnsupportedPriceOrConfirmation(messages: readonly string[], priceGroups: readonly SmokePriceFacts[]): boolean {
  for (const text of messages) {
    if (claimsCompletedAction(text)) return true;
    const claims = [...text.matchAll(/(?:(?:₦|\bNGN\s*)(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:naira|NGN)\b)/gi)];
    for (let index = 0; index < claims.length; index++) {
      const match = claims[index]!;
      const end = match.index + match[0].length;
      const before = text.slice(index === 0 ? 0 : claims[index - 1]!.index + claims[index - 1]![0].length, match.index);
      const after = text.slice(end, claims[index + 1]?.index ?? text.length);
      const field = priceRole(before, after);
      const kobo = Math.round(Number((match[1] ?? match[2])!.replaceAll(",", "")) * 100);
      // ADR 0015: an authoritative fee cannot validate a claimed stay total.
      if (!field || !Number.isSafeInteger(kobo) || !priceGroups.some((facts) => facts[field] === kobo)) return true;
    }
  }
  return false;
}
