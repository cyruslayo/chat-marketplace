import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Slice 09a hides the payments-group managers behind their application façades. Production
// code (`apps/`, non-test) must reach the domain through the façade, never through `.manager`.

const appsRoot = fileURLToPath(new URL("../apps", import.meta.url));
const sourceRoot = fileURLToPath(new URL("../apps/web/src", import.meta.url));
const reachThrough = /(cardPaymentApp|bankTransferApp|conditionalOfferApp|bookingRequestApp|paymentCapabilityApp|transfers|bookingRequestApplication)\??\.manager\./;
const classes = [
  "booking-request-application.ts",
  "conditional-offer-application.ts",
  "card-payment-application.ts",
  "bank-transfer-application.ts",
  "payment-capability-application.ts",
];

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

test("AC1: the five payments-group classes declare no public manager property", () => {
  for (const file of classes) {
    const source = readFileSync(path.join(sourceRoot, file), "utf8");
    assert.doesNotMatch(source, /\breadonly manager\b/, `${file} exposes a manager property`);
  }
});

test("AC2: no payments-group manager reach-through remains in apps/ (non-test)", () => {
  const offenders: string[] = [];
  for (const file of walk(appsRoot)) {
    if (!file.endsWith(".ts")) continue;
    const relative = path.relative(appsRoot, file);
    if (relative.split(path.sep).includes("test")) continue;
    if (reachThrough.test(readFileSync(file, "utf8"))) offenders.push(relative);
  }
  assert.deepEqual(offenders, []);
});
