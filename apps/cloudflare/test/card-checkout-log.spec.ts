import { expect, test } from "vitest";
import type { CardCheckoutFailureReason } from "../../local-guest/src/shortlet-app.js";
import { logCardCheckoutFailed } from "../src/card-checkout-log.js";

// ADR 0075 / ADR 0087: a failed chat card checkout reaches Workers Logs as one closed line only: a fixed event name and the
// closed reason. No offer id, URL, reference, contact, cookie, secret or provider text.

const CLOSED_REASONS: readonly CardCheckoutFailureReason[] = [
  "provider_not_configured",
  "action_rejected",
  "payer_not_authorized",
  "offer_not_payable",
  "provider_rejected",
  "provider_unreachable",
  "provider_response_invalid",
  "checkout_url_rejected",
  "reference_conflict",
  "unclassified",
];

test("A failed card checkout writes exactly one line with the fixed event name and a closed reason only", () => {
  const written: string[] = [];
  logCardCheckoutFailed({ code: "CARD_CHECKOUT_FAILED", reason: "provider_rejected" }, (line) => written.push(line));

  expect(written).toEqual(['{"event":"card_checkout_failed","reason":"provider_rejected"}']);
  const [line] = written as [string];
  expect(Object.keys(JSON.parse(line) as object).sort()).toEqual(["event", "reason"]);
  for (const forbidden of ["offer-", "chk_", "psp_ref", "http", "api.paystack", "sk_test", "guest@", "+234", "@"]) {
    expect(line).not.toContain(forbidden);
  }
});

test("Each closed reason writes one line with the fixed event name and that reason only", () => {
  for (const reason of CLOSED_REASONS) {
    const written: string[] = [];
    logCardCheckoutFailed({ code: "CARD_CHECKOUT_FAILED", reason }, (line) => written.push(line));
    expect(written).toEqual([JSON.stringify({ event: "card_checkout_failed", reason })]);
  }
});

test("The default writer sends the line to console.log, the Workers Logs sink", () => {
  const original = console.log;
  const logged: unknown[] = [];
  console.log = (...args: unknown[]) => {
    logged.push(...args);
  };
  try {
    logCardCheckoutFailed({ code: "CARD_CHECKOUT_FAILED", reason: "unclassified" });
  } finally {
    console.log = original;
  }
  expect(logged).toEqual(['{"event":"card_checkout_failed","reason":"unclassified"}']);
});
