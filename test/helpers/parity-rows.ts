import type { ScriptedTurn } from "./guest-date-fixtures.js";
import type { ParityTurn } from "./parity-fixture.js";
import { PHONE } from "./assistant-stage-journey.js";

// Issue 16: the parity rows, shared by the offline suite (test/assistant-parity.test.ts) and the owner-run live script
// (scripts/parity-live.ts). A row never names a path; each row is compared on both paths.

export const LEKKI = { city: "Lagos", neighbourhood: "Lekki Phase 1" };
export const SEARCH_TEXT = "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026";
export const SEARCH_SCRIPT: ScriptedTurn = { slots: { ...LEKKI, checkIn: "2026-12-14", nights: 3, guests: 2 }, search: { ...LEKKI, checkIn: "2026-12-14", nights: 3, guests: 2 } };

export interface ParityRow {
  readonly name: string;
  /** The last turn keeps the current results: no discovery surface, and the criteria stay as they were (issue 16 AC3). */
  readonly keepsResults?: true;
  readonly turns: readonly ParityTurn[];
  readonly script: Readonly<Record<string, ScriptedTurn>>;
}

export const ROWS: readonly ParityRow[] = [
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
  // Issue 05 (ADR 0106): a checkout the guest wrote gives the nights; the stay is the same as the check-in and nights form.
  {
    name: "issue 05: a checkout date the guest wrote gives the stay",
    turns: [{ text: "Apartment in Lekki for 2 guests from 14 December 2026 to 17 December 2026" }],
    script: {
      "Apartment in Lekki for 2 guests from 14 December 2026 to 17 December 2026": {
        slots: { ...LEKKI, checkIn: "2026-12-14", checkOut: "2026-12-17", guests: 2 },
        search: { ...LEKKI, checkIn: "2026-12-14", checkOut: "2026-12-17", guests: 2 },
      },
    },
  },
  // Issue 11 (ADR 0106, ADR 0080): a facility question on an open stay is answered from the stay's own listing, on the same unit surface.
  {
    name: "issue 11: a facility question on an open stay",
    turns: [{ text: SEARCH_TEXT }, { tap: true }, { text: "Does it have a gym?" }],
    script: {
      [SEARCH_TEXT]: SEARCH_SCRIPT,
      "Does it have a gym?": { slots: {}, intents: ["details"], tool: { name: "get_unit_details", args: { stayRef: "stay-1", facility: "gym" } } },
    },
  },
  // Issue 12 (ADR 0005, 0106): a change asked once a Booking Request is sent is explained, and nothing is searched or changed.
  {
    name: "issue 12: a change asked after the request is sent is explained",
    turns: [
      { text: SEARCH_TEXT },
      { tap: true },
      { tap: true },
      { tap: true },
      { tap: true, context: { contactValue: PHONE } },
      { tap: true },
      { text: "Can I change the dates?" },
    ],
    script: {
      [SEARCH_TEXT]: SEARCH_SCRIPT,
      "Can I change the dates?": { slots: {}, intents: ["change"] },
    },
  },
  // Issue 16 AC3 (ADR 0106, ADR 0074): a sent Booking Request is not changed by a search that names only a place. The current results stay.
  {
    name: "AC3: a place-only search on a sent stay keeps the current results",
    keepsResults: true,
    turns: [
      { text: SEARCH_TEXT },
      { tap: true },
      { tap: true },
      { tap: true },
      { tap: true, context: { contactValue: PHONE } },
      { tap: true },
      { text: "Lekki" },
    ],
    script: {
      [SEARCH_TEXT]: SEARCH_SCRIPT,
      Lekki: { slots: { ...LEKKI }, intents: ["search"], search: { city: "Lagos", neighbourhood: "Lekki Phase 1" } },
    },
  },
  // Issue 16 AC2: "show me the last one" opens the last result on both paths (the deterministic viewResultIntent; on the assistant path a
  // deterministic pack hook, gated on the validated details intent, runs the same unit detail with no planner round).
  {
    name: "AC2: show me the last one opens the last result",
    turns: [{ text: SEARCH_TEXT }, { text: "show me the last one" }],
    script: { [SEARCH_TEXT]: SEARCH_SCRIPT, "show me the last one": { slots: {}, intents: ["details"], reply: "clarify_stay" } },
  },
  // Issue 16 row for the unchecked behaviour "an unrelated turn keeps the current results" (shortlet-app.ts:1081). The results stay.
  {
    name: "an unrelated turn keeps the current results",
    turns: [{ text: SEARCH_TEXT }, { text: "Thanks, that helps" }],
    script: { [SEARCH_TEXT]: SEARCH_SCRIPT, "Thanks, that helps": { slots: {}, intents: [], scope: "unclear" } },
  },
];

