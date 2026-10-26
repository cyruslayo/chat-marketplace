import { authoritativePriceFacts } from "../../scripts/pilot-agent-smoke-grading.js";
import type { PricedUnitInput } from "../../scripts/concierge-controls-eval.js";

/** Shared fixtures for the authoritative-price grader tests (ADR 0106). Synthetic identifiers and kobo amounts only. */
export const SETUP_FIRST_UNIT_ID = "unit-setup-first";
export const OTHER_UNIT_ID = "unit-other-discovery";

/** The server-resolved facts for the setup first card (kobo). */
export const RESOLVED_PRICE_FACTS = [authoritativePriceFacts({ nightlyKobo: 9_500_000, allInStayTotalKobo: 10_700_000, mandatoryFeesKobo: 1_200_000,
  refundableSecurityDepositKobo: 1_000_000, amountDueNowKobo: 11_700_000 })];

/** A reply whose amounts match RESOLVED_PRICE_FACTS. */
export const PRICED_MESSAGE = "Nightly rate: ₦95,000. All-in total: ₦107,000. Mandatory fees: ₦12,000. Refundable security deposit: ₦10,000.";

/** The default input: the asserted turn priced the setup first card through explain_stay_price and no discovery surface followed it. */
export function pricedUnitInput(overrides: Partial<PricedUnitInput> = {}): PricedUnitInput {
  return { currentUnitId: undefined, priceCallCount: 1, pricedStayRefsMatchFirst: true, expectedFirstUnitId: SETUP_FIRST_UNIT_ID, ...overrides };
}
