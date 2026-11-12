import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { GUEST_FACT_LABELS } from "../apps/web-agent/src/guest-content.js";

// Issue 28 (ADR 0092, counsel gate): only the owner-approved structural line is added; the cancellation and Notice to
// End terms remain counsel text and are not drafted here.

test("AC1: The approved wording is recorded with its source", () => {
  assert.match(GUEST_FACT_LABELS.firstPeriodOnly, /Later Billing Periods are paid separately on their due dates; they are not charged automatically\./);
  const issue = readFileSync(".scratch/ux-guidelines/issues/28-extended-stay-collection-and-notice-copy.md", "utf8");
  assert.match(issue, /Owner decision \(10 Nov 2026\): structural line only/);
});

test("AC2: The wording is shown for Extended Stays only", () => {
  // The copy is used only where a projected Billing Period schedule exists (offer, review, payment).
  const offer = readFileSync("apps/web-agent/src/conditional-offer-a2ui.ts", "utf8");
  const payment = readFileSync("apps/web-agent/src/card-payment-a2ui.ts", "utf8");
  const draft = readFileSync("apps/web-agent/src/request-draft-a2ui.ts", "utf8");
  for (const source of [offer, payment, draft]) assert.match(source, /GUEST_FACT_LABELS\.firstPeriodOnly/);
  // Failure path: the Short Stay presentation does not include the Extended Stay schedule.
  assert.doesNotMatch(readFileSync("apps/web-agent/src/unit-detail-a2ui.ts", "utf8"), /firstPeriodOnly/);
});

test("AC3: No guest string uses lease, tenancy, rent or landlord", () => {
  const source = readFileSync("apps/web-agent/src/guest-content.ts", "utf8");
  assert.doesNotMatch(source, /\b(lease|tenancy|rent|landlord)\b/i);
});
