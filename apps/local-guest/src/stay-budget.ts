/**
 * The guest's stated budget, read by the one deterministic parser both concierge paths use (issue 03b, issue 07).
 * Shared by the deterministic concierge (concierge.ts) and the assistant's shortlet pack (ADR 0080 parity, ADR 0106).
 */

/**
 * Issue 03b / ADR-0015: a budget is compared with the All-In Stay Total and
 * never includes the Refundable Security Deposit (ADR-0016). A nightly budget
 * is kept as nightly and converted with the current nights at search time.
 */
export interface StayBudget {
  readonly kobo: number;
  readonly per: "stay" | "night";
}

const NAIRA_AMOUNT = "(₦|ngn\\s*|n(?=\\d))?\\s*(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(k|m|million|thousand)?\\b\\s*(naira)?";
const PER_NIGHT = "(\\s*(?:a|per|\\/|each|every)\\s*night)?";
// Words a Guest puts between "budget" and the amount ("my budget is around ₦400k").
const BUDGET_FILLER = "(?:\\s+(?:is|of|about|around|roughly|approximately|approx\\.?|at most|max|maximum))*";
const BUDGET_PATTERN = new RegExp(`\\b(?:budget${BUDGET_FILLER}|under|below|max(?:imum)?|up to|no more than|not more than|less than)\\s*:?\\s*${NAIRA_AMOUNT}${PER_NIGHT}`, "gi");
// The amount first: "₦400k budget", "500,000 naira total budget".
const AMOUNT_BUDGET_PATTERN = new RegExp(`${NAIRA_AMOUNT}${PER_NIGHT}\\s+(?:total\\s+)?budget\\b`, "gi");
const PRICED_NIGHT_PATTERN = new RegExp(`(₦|ngn\\s*)\\s*(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(k|m|million|thousand)?\\b\\s*(naira)?(\\s*(?:a|per|\\/|each|every)\\s*night)`, "gi");
const AMOUNT_MULTIPLIERS: Readonly<Record<string, number>> = { k: 1_000, thousand: 1_000, m: 1_000_000, million: 1_000_000 };

/**
 * Issue 03b: "budget ₦500k", "under 200,000 naira", "₦60k a night". A bare
 * small number ("under 3 nights", "max 4 guests") is never read as money: it
 * needs a currency mark, a k/m multiplier, "naira", or at least ₦1,000.
 */
export function extractBudget(text: string): StayBudget | undefined {
  for (const match of [...text.matchAll(BUDGET_PATTERN), ...text.matchAll(AMOUNT_BUDGET_PATTERN), ...text.matchAll(PRICED_NIGHT_PATTERN)]) {
    const [, currency, digits, multiplier, naira, perNight] = match;
    const value = Number.parseFloat((digits ?? "").replaceAll(",", "")) * (multiplier ? AMOUNT_MULTIPLIERS[multiplier.toLowerCase()] ?? 1 : 1);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!currency && !multiplier && !naira && value < 1_000) continue;
    return { kobo: Math.round(value * 100), per: perNight ? "night" : "stay" };
  }
  return undefined;
}
