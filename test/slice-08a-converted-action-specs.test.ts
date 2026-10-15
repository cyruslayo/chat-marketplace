import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Slice 08a converts the booking-funnel actions onto the platform gate. These checks read
// the five files to confirm no local gate copy survives (ADR 0099 rule 3).

const convertedFiles = [
  "booking-request-actions.ts",
  "conditional-offer-actions.ts",
  "booking-amendment-actions.ts",
  "cancellation-actions.ts",
  "payment-capability-actions.ts",
];

function sourceOf(file: string): string {
  return readFileSync(new URL(`../apps/web/src/${file}`, import.meta.url), "utf8");
}

test("AC1: Each of the five files contains no gate logic and declares only its spec and domain call", () => {
  for (const file of convertedFiles) {
    const source = sourceOf(file);
    assert.match(source, /ActionSpec/, `${file} declares an ActionSpec`);
    assert.match(source, /resolveAction/, `${file} resolves through the platform gate`);
    assert.doesNotMatch(source, /function reject\(|const reject\s*=/, `${file} has no local rejection helper`);
  }
});

test("AC3: contextOf copies in these files are gone", () => {
  for (const file of convertedFiles) {
    const source = sourceOf(file);
    assert.doesNotMatch(source, /contextOf|readContext/, `${file} has no contextOf/readContext copy`);
  }
});
