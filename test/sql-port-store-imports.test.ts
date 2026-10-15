import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Slice 16: the contact and account-authority stores now live in the platform Accounts module (ADR 0099 rule 2).
const stores: ReadonlyArray<readonly [string, string]> = [
  ["manual-transfer", "../domains/shortlet/src/manual-transfer.ts"],
  ["owner-payable", "../domains/shortlet/src/owner-payable.ts"],
  ["booking-state", "../domains/shortlet/src/booking-state.ts"],
  ["bank-transfer", "../domains/shortlet/src/bank-transfer.ts"],
  ["booking-payment-journey", "../domains/shortlet/src/booking-payment-journey.ts"],
  ["checkin-support", "../domains/shortlet/src/checkin-support.ts"],
  ["guest-contact", "../packages/platform-core/src/accounts/contact.ts"],
  ["availability-store", "../domains/shortlet/src/availability-store.ts"],
  ["guest-interaction-store", "../domains/shortlet/src/guest-interaction-store.ts"],
  ["operator-representative-authority", "../domains/shortlet/src/operator-representative-authority.ts"],
  ["operator-session-authority", "../domains/shortlet/src/operator-session-authority.ts"],
  ["guest-account-authority", "../packages/platform-core/src/accounts/authority.ts"],
];

test("AC1: None of the converted stores imports node:sqlite", () => {
  for (const [store, path] of stores) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /(?:from\s+|import\s*\()\s*["']node:sqlite["']/,
      store,
    );
    assert.match(source, /SqlDatabase/, store);
  }
});
