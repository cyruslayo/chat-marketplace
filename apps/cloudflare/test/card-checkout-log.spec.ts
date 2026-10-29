import { expect, test } from "vitest";
import type { CardCheckoutFailedEvent, CardCheckoutFailureReason } from "../../local-guest/src/shortlet-app.js";
import { PAYSTACK_PROVIDER_STATUS_CLASSES } from "../../../packages/platform-core/src/payments/paystack.js";
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
  for (const forbidden of ["offer-", "chk_", "psp_ref", "psp-ref", "http", "api.paystack", "sk_test", "guest@", "+234", "@"]) {
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

// ADR 0075: a provider rejection adds exactly one closed HTTP-status class. Nothing else from the provider is written.
test("A provider rejection writes its closed status class and no other key", () => {
  for (const statusClass of PAYSTACK_PROVIDER_STATUS_CLASSES) {
    const written: string[] = [];
    logCardCheckoutFailed({ code: "CARD_CHECKOUT_FAILED", reason: "provider_rejected", statusClass }, (line) => written.push(line));
    expect(written).toEqual([JSON.stringify({ event: "card_checkout_failed", reason: "provider_rejected", statusClass })]);
    const [line] = written as [string];
    expect(Object.keys(JSON.parse(line) as object).sort()).toEqual(["event", "reason", "statusClass"]);
  }
});

test("The status class is omitted for every reason other than provider_rejected", () => {
  for (const reason of CLOSED_REASONS.filter((candidate) => candidate !== "provider_rejected")) {
    const written: string[] = [];
    logCardCheckoutFailed({ code: "CARD_CHECKOUT_FAILED", reason, statusClass: "server_error" } as CardCheckoutFailedEvent, (line) => written.push(line));
    expect(written).toEqual([JSON.stringify({ event: "card_checkout_failed", reason })]);
  }
});

test("A status class outside the closed list is omitted rather than written", () => {
  const written: string[] = [];
  logCardCheckoutFailed({ code: "CARD_CHECKOUT_FAILED", reason: "provider_rejected", statusClass: "Bearer sk_test_synthetic" } as unknown as CardCheckoutFailedEvent, (line) => written.push(line));
  expect(written).toEqual(['{"event":"card_checkout_failed","reason":"provider_rejected"}']);
  expect(written[0]).not.toContain("sk_test");
});
