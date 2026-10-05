import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stores = [
  "manual-transfer",
  "owner-payable",
  "booking-state",
  "bank-transfer",
  "booking-payment-journey",
  "checkin-support",
  "guest-contact",
  "availability-store",
  "guest-interaction-store",
];

test("AC1: None of the converted stores imports node:sqlite", () => {
  for (const store of stores) {
    const source = readFileSync(
      new URL(`../domains/shortlet/src/${store}.ts`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /(?:from\s+|import\s*\()\s*["']node:sqlite["']/,
      store,
    );
    assert.match(source, /SqlDatabase/, store);
  }
});
