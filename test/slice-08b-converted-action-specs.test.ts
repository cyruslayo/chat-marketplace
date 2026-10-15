import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Slice 08b converts the stay-support actions onto the platform gate. `discovery-actions.ts`
// is left unconverted (documented in the issue): it yields a conventional-route effect and an
// INVALID_ROUTE check the artifact gate does not model.

const convertedFiles = [
  "checkin-support-actions.ts",
  "checkout-overstay-actions.ts",
  "mid-stay-failure-actions.ts",
  "relocation-actions.ts",
  "deposit-claim-actions.ts",
  "guest-conduct-actions.ts",
  "human-handoff-actions.ts",
];

function sourceOf(file: string): string {
  return readFileSync(new URL(`../apps/web/src/${file}`, import.meta.url), "utf8");
}

test("AC1: Each converted stay-support file contains no gate logic and declares only its spec and domain call", () => {
  for (const file of convertedFiles) {
    const source = sourceOf(file);
    assert.match(source, /ActionSpec/, `${file} declares an ActionSpec`);
    assert.match(source, /resolveAction/, `${file} resolves through the platform gate`);
    assert.doesNotMatch(source, /contextOf|readContext|parseContext/, `${file} has no context allow-list copy`);
    assert.doesNotMatch(source, /function reject\(|const reject\s*=/, `${file} has no local rejection helper`);
  }
});

test("AC1: discovery-actions.ts is the documented exception and still owns its route effect", () => {
  const source = sourceOf("discovery-actions.ts");
  assert.match(source, /INVALID_ROUTE/);
  assert.match(source, /open-conventional-route/);
  assert.doesNotMatch(source, /ActionSpec/);
});
