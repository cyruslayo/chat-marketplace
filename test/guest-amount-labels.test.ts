import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_FACT_LABELS } from "../apps/web-agent/src/guest-content.js";
import { visibleText } from "./helpers/guest-payment-page.js";
import { withStagePage, type StagePageSpec } from "./helpers/guest-stage-pages.js";

// Guest UI consistency issue 12: one meaning per amount label on every guest screen.
// Fixture: All-In Stay Total ₦370,000, Refundable Security Deposit ₦20,000.

const TOTAL = "₦390,000";
const STAY = "₦370,000";

async function pageText(spec: StagePageSpec): Promise<string> {
  return withStagePage(spec, async ({ fixture, path }) => {
    const response = await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie, accept: "text/html" }, redirect: "manual" });
    assert.equal(response.status, 200, spec.label);
    return visibleText(await response.text());
  });
}

test("AC1: the label table records one meaning for each amount label", () => {
  assert.equal(GUEST_FACT_LABELS.amountDueNow, "Total to complete booking");
  assert.equal(GUEST_FACT_LABELS.thisPayment, "This payment");
  assert.equal(GUEST_FACT_LABELS.amountPaid, "Stay payment paid");
});

test("AC2: 'Total to complete booking' is the stay plus the deposit on every screen that shows it, and a single payment is never given that label", async () => {
  for (const spec of [
    { label: "Request review", stage: "review" },
    { label: "Offer", stage: "offer" },
    { label: "Payment choice", stage: "payment-ready" },
    { label: "Provider bank transfer", stage: "payment-ready", start: "transfer" },
  ] as const satisfies readonly StagePageSpec[]) {
    const text = await pageText(spec);
    assert.ok(text.includes(`${GUEST_FACT_LABELS.amountDueNow}: ${TOTAL}`), `${spec.label}: total to complete the booking is ${TOTAL}`);
    assert.doesNotMatch(text, /Amount due now/, spec.label);
  }
  // The pages that ask for one payment name it "This payment", never the total's label.
  for (const spec of [
    { label: "Provider bank transfer", stage: "payment-ready", start: "transfer" },
    { label: "Manual bank transfer", stage: "payment-ready", start: "manual-transfer" },
  ] as const satisfies readonly StagePageSpec[]) {
    const text = await pageText(spec);
    assert.ok(text.includes(`${GUEST_FACT_LABELS.thisPayment}: ${STAY}`), `${spec.label}: this payment is ${STAY}`);
    assert.ok(!text.includes(`${GUEST_FACT_LABELS.amountDueNow}: ${STAY}`), `${spec.label}: the stay payment alone is not the total`);
  }
  const confirmed = await pageText({ label: "Reservation confirmed", stage: "confirmed" });
  assert.ok(confirmed.includes(`${GUEST_FACT_LABELS.amountPaid}: ${STAY}`), "confirmed: the stay payment paid");
  assert.doesNotMatch(confirmed, /Amount paid/);
});
