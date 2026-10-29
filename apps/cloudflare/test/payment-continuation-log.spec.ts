import { expect, test } from "vitest";
import { paymentContinuationRejectionReason, type PaymentContinuationRejectionReason } from "../../local-guest/src/guest-server.js";
import { logPaymentContinuationRejected } from "../src/payment-continuation-log.js";

// ADR 0075 / ADR 0087: a rejected payment continuation reaches Workers Logs as one closed line only: a fixed event name
// and the closed reason. No offer id, URL, reference, cookie, secret, contact or provider text.

const CLOSED_REASONS: readonly PaymentContinuationRejectionReason[] = ["offer_not_accepted", "contact_missing", "payment_window_closed", "provider_start_failed", "unclassified"];

test("A rejected payment continuation writes exactly one closed line with no identifiers, URLs or secrets", () => {
  // A provider failure whose message carries an offer id, a URL, a secret-looking key, a reference and a contact.
  const providerError = new Error("Paystack rejected https://api.paystack.co/transaction/initialize for offer-synthetic-7f3a with sk_test_synthetic ref psp_ref_123 guest@example.test +2348012345678");
  const reason = paymentContinuationRejectionReason(providerError);
  expect(reason).toBe("provider_start_failed");

  const written: string[] = [];
  logPaymentContinuationRejected({ code: "PAYMENT_CONTINUATION_REJECTED", reason }, (line) => written.push(line));

  expect(written).toEqual(['{"event":"payment_continuation_rejected","reason":"provider_start_failed"}']);
  const [line] = written as [string];
  expect(Object.keys(JSON.parse(line) as object).sort()).toEqual(["event", "reason"]);
  for (const forbidden of ["offer-", "7f3a", "http", "api.paystack", "sk_test", "psp_ref", "psp-ref", "guest@", "+234", "@"]) {
    expect(line).not.toContain(forbidden);
  }
});

test("Each closed reason writes one line with the fixed event name and that reason only", () => {
  for (const reason of CLOSED_REASONS) {
    const written: string[] = [];
    logPaymentContinuationRejected({ code: "PAYMENT_CONTINUATION_REJECTED", reason }, (line) => written.push(line));
    expect(written).toEqual([JSON.stringify({ event: "payment_continuation_rejected", reason })]);
  }
});

test("The default writer sends the line to console.log, the Workers Logs sink", () => {
  const original = console.log;
  const logged: unknown[] = [];
  console.log = (...args: unknown[]) => { logged.push(...args); };
  try {
    logPaymentContinuationRejected({ code: "PAYMENT_CONTINUATION_REJECTED", reason: "unclassified" });
  } finally {
    console.log = original;
  }
  expect(logged).toEqual(['{"event":"payment_continuation_rejected","reason":"unclassified"}']);
});
