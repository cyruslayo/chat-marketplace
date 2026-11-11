import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Issue 16 (ADR 0078, 0081; guideline §8): a guest-path Modal would need a native dialog. No guest A2UI surface emits
// one; the only Modal mentions are Weaver's registered renderer and its catalogue schema.

function emitsModal(source: string): boolean {
  return /component\s*:\s*["']Modal["']/.test(source);
}

function guestBuilderFiles(): string[] {
  return [
    ...readdirSync("apps/web-agent/src").filter((name) => name.endsWith("-a2ui.ts")).map((name) => join("apps/web-agent/src", name)),
    ...readdirSync("apps/local-guest/src/assistant").filter((name) => name.endsWith("-a2ui.ts")).map((name) => join("apps/local-guest/src/assistant", name)),
    ...readdirSync("domains/shortlet/src").filter((name) => name.endsWith(".ts")).map((name) => join("domains/shortlet/src", name)),
  ];
}

test("AC1: Use of Modal on the guest path is recorded", () => {
  const offenders = guestBuilderFiles().filter((path) => emitsModal(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, [], "no guest A2UI builder or shortlet domain module emits a Modal");
  // The failure path proves the detector catches a real emission.
  assert.equal(emitsModal('{ id: "m", component: "Modal", children: [] }'), true);
  assert.equal(emitsModal('{ id: "c", component: "Card", child: "x" }'), false);
});
