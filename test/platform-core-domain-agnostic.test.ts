import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// ADR 0099 rule 4: platform-core declares no domain specifics. Shortlet (and later commerce)
// supply their own field names through pack config instead.

const platformCoreSource = fileURLToPath(new URL("../packages/platform-core/src", import.meta.url));
const DOMAIN_LITERALS = ["activeStay", "bookingId", "booking_summary"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
  });
}

test("AC2: platform-core source contains no activeStay, bookingId or booking_summary literals", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(platformCoreSource)) {
    const source = readFileSync(file, "utf8");
    for (const literal of DOMAIN_LITERALS) {
      if (source.includes(literal)) offenders.push(`${path.relative(platformCoreSource, file)}: ${literal}`);
    }
  }
  assert.deepEqual(offenders, []);
});
