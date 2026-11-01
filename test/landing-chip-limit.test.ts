import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { MAX_STAY_NIGHTS } from "../domains/shortlet/src/browse.js";
import { LANDING_COPY, validateExampleChips } from "../apps/local-guest/src/landing-copy.js";

// Issue 03 (ADR 0023 as amended 1 Nov 2026): the landing chip validator takes the Short Stay limit from the domain.

test("AC1: validateExampleChips accepts a chip of 29 nights and refuses one of 30 nights and one of 0 nights, naming the 1–29 range", () => {
  assert.equal(MAX_STAY_NIGHTS, 29, "the domain Short Stay maximum is 29 nights");
  assert.deepEqual(
    validateExampleChips([{ text: "Ikoyi, 29 nights", nights: 29 }]),
    [],
    "a 29-night chip is accepted",
  );

  const tooLong = validateExampleChips([{ text: "Ikoyi, 30 nights", nights: 30 }]);
  assert.equal(tooLong.length, 1, "a 30-night chip is refused");
  assert.match(tooLong[0]!, /a Short Stay is 1 to 29 nights \(ADR 0023\)/, "the refusal names the 1–29 range");

  const noNights = validateExampleChips([{ text: "Ikoyi, no nights", nights: 0 }]);
  assert.equal(noNights.length, 1, "a 0-night chip is refused");
  assert.match(noNights[0]!, /a Short Stay is 1 to 29 nights \(ADR 0023\)/, "the refusal names the 1–29 range");
});

test("AC2: The landing module has no stay-length constant of its own; the limit comes from MAX_STAY_NIGHTS", () => {
  const source = readFileSync(fileURLToPath(new URL("../apps/local-guest/src/landing-copy.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /LAUNCH_MAX_STAY_NIGHTS/, "the local launch constant is removed");
  assert.doesNotMatch(source, /(?:const|let)\s+\w*(?:MAX|NIGHTS)\w*\s*=\s*\d/, "no stay-length number is declared in the module");
  assert.match(source, /import \{ MAX_STAY_NIGHTS \} from "\.\.\/\.\.\/\.\.\/domains\/shortlet\/src\/browse\.js";/, "the module imports the domain limit");
});

test("AC3: The approved chips and the landing copy tests (test/landing-page.test.ts) pass unchanged", () => {
  assert.deepEqual(
    LANDING_COPY.exampleChips.map((chip) => ({ text: chip.text, nights: chip.nights })),
    [
      { text: "Somewhere quiet in Abuja for a week", nights: 7 },
      { text: "Lekki, 3 nights from Friday, 4 of us", nights: 3 },
      { text: "Ikoyi, 2 weeks from 10 Sept", nights: 14 },
    ],
    "the three approved chips are unchanged",
  );
  assert.deepEqual(validateExampleChips(LANDING_COPY.exampleChips), [], "every approved chip passes the validator");
});
