/** Public price facts supplied by a domain projection or quote (ADR 0015). */
export interface SmokePriceFacts {
  readonly nightlyKobo?: number;
  readonly allInStayTotalKobo?: number | null;
  readonly mandatoryFeesKobo?: number;
  readonly refundableSecurityDepositKobo?: number;
  readonly amountDueNowKobo?: number | null;
}

export function authoritativePriceAmounts(facts: SmokePriceFacts): readonly (number | null)[] {
  return [facts.nightlyKobo ?? null, facts.allInStayTotalKobo ?? null, facts.mandatoryFeesKobo ?? null,
    facts.refundableSecurityDepositKobo ?? null, facts.amountDueNowKobo ?? null];
}

/** Evaluate in memory; never persist model prose or matched text (ADR 0075). */
export function hasUnsupportedPriceOrConfirmation(messages: readonly string[], priceGroups: readonly (readonly (number | null)[])[]): boolean {
  const text = messages.join(" ");
  const confirmations = /\b(?:(?:booking|reservation) (?:(?:is|has been) )?confirmed|payment (?:(?:is|has been) )?(?:successful|confirmed|complete)|booked)\b/gi;
  for (const match of text.matchAll(confirmations)) {
    const prefix = text.slice(0, match.index);
    if (!/\b(?:not|never|isn't|aren't|haven't|hasn't)(?:\s+been)?\s*$/i.test(prefix)) return true;
  }
  const authoritativeKobo = new Set(priceGroups.flatMap((group) => group.filter((amount): amount is number => typeof amount === "number" && Number.isFinite(amount))));
  const claims = [...text.matchAll(/(?:₦|\bNGN\s*)([\d,]+(?:\.\d{1,2})?)/gi)];
  return claims.some((match) => {
    const naira = Number(match[1]?.replaceAll(",", ""));
    return !Number.isFinite(naira) || !authoritativeKobo.has(Math.round(naira * 100));
  });
}
