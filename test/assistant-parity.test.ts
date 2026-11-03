import assert from "node:assert/strict";
import test from "node:test";
import type { ScriptedTurn } from "./helpers/guest-date-fixtures.js";
import { runParityPath, type ParityTurn } from "./helpers/parity-fixture.js";

// Issue 16 (ADR 0080, ADR 0106): the same guest turns through the deterministic concierge and the assistant must give the same
// filters and surface kinds. One test per row (AC1). Both paths run on the staging clock (27 Oct 2026), a staging-like guest, and a
// cold restore before every event (test/helpers/parity-fixture.ts). The scripted planner answers only for the assistant path.

const LEKKI = { city: "Lagos", neighbourhood: "Lekki Phase 1" };
const SEARCH_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
const SEARCH_SCRIPT: ScriptedTurn = { slots: { ...LEKKI, checkIn: "2026-12-14", nights: 3, guests: 2 }, search: { ...LEKKI, checkIn: "2026-12-14", nights: 3, guests: 2 } };

interface ParityRow {
  readonly name: string;
  readonly turns: readonly ParityTurn[];
  readonly script: Readonly<Record<string, ScriptedTurn>>;
}

const ROWS: readonly ParityRow[] = [
  // Issues 04, 05: a stay with a check-in and nights.
  { name: "issues 04 and 05: a search with a check-in and nights", turns: [{ text: SEARCH_TEXT }], script: { [SEARCH_TEXT]: SEARCH_SCRIPT } },
  // Issue 07: a budget the guest words in naira.
  {
    name: "issue 07: a budget from the guest's own words",
    turns: [{ text: `${SEARCH_TEXT} under ₦150k a night` }],
    script: { [`${SEARCH_TEXT} under ₦150k a night`]: { slots: SEARCH_SCRIPT.slots, search: { ...LEKKI, checkIn: "2026-12-14", nights: 3, guests: 2, budgetPhrase: "under ₦150k a night" } } },
  },
  // Issue 08: an amenity from the closed list.
  {
    name: "issue 08: an amenity from the closed list",
    turns: [{ text: `${SEARCH_TEXT} with steady light` }],
    script: { [`${SEARCH_TEXT} with steady light`]: { slots: SEARCH_SCRIPT.slots, search: { ...LEKKI, checkIn: "2026-12-14", nights: 3, guests: 2, requiredAmenities: ["24_7_power_generator"] } } },
  },
  // Issue 04: a relative check-in is shown back and not searched, on both paths.
  {
    name: "issue 04: a relative check-in is shown back before any search",
    turns: [{ text: "Apartment in Lekki for 2 guests, 3 nights from tomorrow" }],
    script: { "Apartment in Lekki for 2 guests, 3 nights from tomorrow": { slots: { ...LEKKI, nights: 3, guests: 2 }, search: { ...LEKKI, checkInPhrase: "tomorrow", nights: 3, guests: 2 } } },
  },
  // Issue 13 (13a): nights changed on an open Request Draft are a replacement, not a search.
  {
    name: "issue 13: nights changed on a Request Draft propose a replacement",
    turns: [{ text: "Apartment in Lekki for 2 guests, 2 nights from 14 December 2026" }, { tap: true }, { tap: true }, { text: "make it 3 nights" }],
    script: {
      "Apartment in Lekki for 2 guests, 2 nights from 14 December 2026": { slots: { ...LEKKI, checkIn: "2026-12-14", nights: 2, guests: 2 }, search: { ...LEKKI, checkIn: "2026-12-14", nights: 2, guests: 2 } },
      "make it 3 nights": { slots: { nights: 3 }, search: { city: "Lagos", nights: 3, guests: 2 } },
    },
  },
  // Issue 09: a neighbourhood switch within the held city changes the area at once, as the deterministic path does.
  {
    name: "issue 09: a neighbourhood switch in the held city changes the area",
    turns: [{ text: SEARCH_TEXT }, { text: "Actually, show me Ikoyi instead" }],
    script: {
      [SEARCH_TEXT]: SEARCH_SCRIPT,
      "Actually, show me Ikoyi instead": { slots: { city: "Lagos", neighbourhood: "Ikoyi" }, search: { city: "Lagos", neighbourhood: "Ikoyi", checkIn: "2026-12-14", nights: 3, guests: 2 } },
    },
  },
  // Issue 13 (13b): a relative date on an open Request Draft is shown back, and nothing is quoted before the guest confirms.
  {
    name: "issue 13b: a relative date on a Request Draft is shown back before a replacement",
    turns: [{ text: "Apartment in Lekki for 2 guests, 2 nights from 14 December 2026" }, { tap: true }, { tap: true }, { text: "make it from tomorrow" }],
    script: {
      "Apartment in Lekki for 2 guests, 2 nights from 14 December 2026": { slots: { ...LEKKI, checkIn: "2026-12-14", nights: 2, guests: 2 }, search: { ...LEKKI, checkIn: "2026-12-14", nights: 2, guests: 2 } },
      "make it from tomorrow": { slots: { nights: 2 }, search: { city: "Lagos", checkInPhrase: "tomorrow", nights: 2, guests: 2 } },
    },
  },
  // Issue 16 row for the unchecked behaviour "an unrelated turn keeps the current results" (shortlet-app.ts:1081). The results stay.
  {
    name: "an unrelated turn keeps the current results",
    turns: [{ text: SEARCH_TEXT }, { text: "Thanks, that helps" }],
    script: { [SEARCH_TEXT]: SEARCH_SCRIPT, "Thanks, that helps": { slots: {}, intents: [], scope: "unclear" } },
  },
];

ROWS.forEach((row, index) => {
  test(`parity: ${row.name} gives the same filters and surface kinds on both paths`, async () => {
    const threadId = `g-16${(index + 1).toString(16).padStart(6, "0")}`;
    const deterministic = await runParityPath("deterministic", row.turns, row.script, threadId);
    const assistant = await runParityPath("assistant", row.turns, row.script, threadId);
    assert.deepEqual(assistant.map((step) => step.kinds), deterministic.map((step) => step.kinds), "surface kinds");
    assert.deepEqual(assistant.map((step) => step.filters), deterministic.map((step) => step.filters), "filters");
  });
});
