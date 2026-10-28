import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * Issue 04 (ADR 0099): the platform names no domain. Shortlet and commerce tool names, pending-action kinds, stage names,
 * domain literals and domain imports live in their packs and stage handlers. The platform files below are scanned for each
 * pattern, and the scan must equal a NAMED allowlist exactly: a new occurrence fails, and so does a stale allowlist entry.
 * Every allowlist entry names its follow-up: issue 04 decision a, or the follow-up issue 07 (its file must exist).
 */

const PLATFORM_FILES = [
  "apps/local-guest/src/assistant/assistant-runtime.ts",
  "apps/local-guest/src/assistant/assistant-platform.ts",
  "apps/local-guest/src/assistant/assistant-stage-handler.ts",
  "apps/local-guest/src/assistant/assistant-turn-transaction.ts",
] as const;

/** The follow-up issue that owns the Shortlet public API exceptions (issue 04 decision b). */
const FOLLOW_UP_FILE = "07-move-the-shortlet-public-api-out-of-the-runtime.md";
const ISSUES_DIR = new URL("../.scratch/assistant-runtime-hardening/issues/", import.meta.url);

const SHORTLET_TOOL_NAMES = [
  "search_stays", "compare_stays", "explain_stay_price", "get_booking_status", "get_offer_status", "get_unit_details",
  "prepare_request_draft", "propose_accept_offer", "propose_request_to_book", "propose_start_payment",
];
const COMMERCE_TOOL_NAMES = ["add_to_store_cart", "get_offer", "get_order_status", "propose_checkout", "quote_delivery", "search_products"];
const PENDING_ACTION_KINDS = ["request_to_book", "accept_offer", "start_checkout", "commerce.checkout.confirm"];
const STAGE_NAMES = ["discovery", "unit", "request", "offer", "payment", "booking"];

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordAlternation = (names: readonly string[]): string => `(^|[^A-Za-z0-9_])(${names.map(escapeRegex).join("|")})($|[^A-Za-z0-9_])`;

/**
 * Each pattern names what it catches. A pattern with no allowlist entry must have zero matches in every platform file.
 * The domain-import pattern matches any statement that brings in a ./shortlet* or ./commerce* module: a regular or type import,
 * a side-effect import, a re-export (`export ... from`), or a dynamic import (`import(...)`), in either quote form, single or
 * multi-line.
 */
const PATTERNS: readonly { readonly id: string; readonly source: string }[] = [
  { id: "shortlet tool name", source: wordAlternation(SHORTLET_TOOL_NAMES) },
  { id: "commerce tool name", source: wordAlternation(COMMERCE_TOOL_NAMES) },
  { id: "pending-action kind", source: wordAlternation(PENDING_ACTION_KINDS) },
  { id: "stage name literal", source: `["'\`](${STAGE_NAMES.join("|")}|commerce)["'\`]` },
  { id: "domain literal shortlet", source: `["'\`]shortlet["'\`]` },
  { id: "domain literal commerce", source: `["'\`]commerce["'\`]` },
  { id: "domain import", source: `\\b(?:import|export)\\b[^;]*?["']\\.\\/(?:shortlet|commerce)[^"']*["']` },
  { id: "shortlet import: createShortletAssistantPack", source: `\\bcreateShortletAssistantPack\\b` },
  { id: "shortlet import: validatedCheckOutForNights", source: `\\bvalidatedCheckOutForNights\\b` },
  { id: "template stage key", source: `\\$\\{[^}]+\\}:(\\$\\{|[a-z_])` },
];

/**
 * The documented exceptions. `count` is the exact number of matches in that file. `followUp` names the owner: "issue 04 decision a"
 * (commerce handler objects deferred), or the follow-up issue 07 by its file name (the Shortlet public API, decision b).
 */
const ALLOWLIST: readonly { readonly file: string; readonly pattern: string; readonly count: number; readonly followUp: string; readonly label: string }[] = [
  { file: "assistant-runtime.ts", pattern: "domain literal shortlet", count: 2, followUp: `issue 07 (${FOLLOW_UP_FILE})`,
    label: "restoreShortletState's Shortlet domain check (Shortlet public API)." },
  { file: "assistant-runtime.ts", pattern: "domain import", count: 1, followUp: `issue 07 (${FOLLOW_UP_FILE})`,
    label: "The import of ./shortlet-assistant-pack.js for validatedCheckOutForNights (Shortlet public API)." },
  { file: "assistant-runtime.ts", pattern: "shortlet import: validatedCheckOutForNights", count: 2, followUp: `issue 07 (${FOLLOW_UP_FILE})`,
    label: "validatedCheckOutForNights: the import above and recordGuestStay's checkout derivation (Shortlet public API)." },
  { file: "assistant-runtime.ts", pattern: "template stage key", count: 4, followUp: `issue 04 decision a; issue 07 (${FOLLOW_UP_FILE})`,
    label: "Four surface-id templates: the platform action gate key `<pack id>:checkout` (ADR 0099 section 3); the generic projected-surface key `<pack id>:<kind>` (commerce path, decision a); the pending-card surface id (platform, ADR 0074); the restored pending-card id in restoreShortletState (Shortlet public API, issue 07)." },
  { file: "assistant-platform.ts", pattern: "stage name literal", count: 1, followUp: "issue 04 decision a",
    label: "projectedSurface kind union `discovery | cart | checkout | order`: the generic projected-surface contract whose kinds commerce supplies." },
];

const SOURCES = new Map(PLATFORM_FILES.map((file) => [file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8")]));

function countMatches(source: string, patternId: string): number {
  const pattern = PATTERNS.find((entry) => entry.id === patternId);
  assert.ok(pattern, `${patternId} is a known pattern`);
  return [...source.matchAll(new RegExp(pattern.source, "g"))].length;
}

function scan(): string[] {
  const found: string[] = [];
  for (const [file, source] of SOURCES) {
    for (const { id } of PATTERNS) {
      const count = countMatches(source, id);
      if (count > 0) found.push(`${file.split("/").pop()}|${id}|${count}`);
    }
  }
  return found.sort();
}

test("assistant-runtime.ts contains no shortlet or commerce tool names, pending-action kinds or stage names", () => {
  const runtime = SOURCES.get("apps/local-guest/src/assistant/assistant-runtime.ts") ?? "";
  for (const name of [...SHORTLET_TOOL_NAMES, ...COMMERCE_TOOL_NAMES, ...PENDING_ACTION_KINDS]) {
    assert.doesNotMatch(runtime, new RegExp(wordAlternation([name])), `runtime names ${name}`);
  }
  for (const name of STAGE_NAMES) {
    assert.doesNotMatch(runtime, new RegExp(`["'\`]${name}["'\`]`), `runtime names stage ${name}`);
  }
});

test("the domain-import pattern flags a Shortlet or commerce side-effect, multi-line, re-export or dynamic import, in either quote form", () => {
  const flagged = [
    "import './shortlet-stage-handlers.js';",
    "import { SHORTLET_STAGE_HANDLERS } from './shortlet-stage-handlers.js';",
    'import {\n  SHORTLET_STAGE_HANDLERS,\n  proposalStillAuthorised,\n} from "./shortlet-stage-handlers.js";',
    'import type { y } from "./shortlet-assistant-pack.js";',
    "import './commerce-assistant-pack.js';",
    'export { SHORTLET_STAGE_HANDLERS } from "./shortlet-stage-handlers.js";',
    "export * from './commerce-assistant-pack.js';",
    "const module = await import('./shortlet-stage-handlers.js');",
    'const other = await import("./commerce-assistant-pack.js");',
  ];
  for (const probe of flagged) {
    assert.equal(countMatches(probe, "domain import"), 1, `flags: ${probe.split("\n")[0]}`);
  }
  for (const clean of ['import { z } from "./assistant-platform.js";', "export { w } from './assistant-stage-handler.js';"]) {
    assert.equal(countMatches(clean, "domain import"), 0, `not flagged: ${clean}`);
  }
});

test("the platform files match the named boundary allowlist exactly (no new domain name, import or stage key; no stale entry)", () => {
  const expected = ALLOWLIST.map((entry) => `${entry.file}|${entry.pattern}|${entry.count}`).sort();
  assert.deepEqual(scan(), expected, "every platform-file match is a named, counted exception");
});

test("every allowlist entry names its follow-up (issue 04 decision a, or issue 07 whose file exists) and a real occurrence", () => {
  for (const entry of ALLOWLIST) {
    assert.ok(entry.followUp.includes("issue 04 decision a") || entry.followUp.includes(FOLLOW_UP_FILE), `${entry.pattern} names its follow-up`);
    if (entry.followUp.includes(FOLLOW_UP_FILE)) {
      assert.ok(existsSync(new URL(FOLLOW_UP_FILE, ISSUES_DIR)), `the follow-up file ${FOLLOW_UP_FILE} exists`);
    }
    assert.ok(entry.label.length > 0, `${entry.pattern} is labelled`);
    assert.ok(PATTERNS.some((pattern) => pattern.id === entry.pattern), `${entry.pattern} is a known pattern`);
    assert.ok(entry.count >= 1, `${entry.pattern} counts a real occurrence`);
  }
});

test("the follow-up issue 07 is blocked by issue 04 and names the Shortlet public API it moves", () => {
  const issue = readFileSync(new URL(FOLLOW_UP_FILE, ISSUES_DIR), "utf8");
  assert.match(issue, /^Blocked by: 04$/m);
  for (const name of ["restoreShortletState", "recordGuestStay", "recordGuestArea", "selectShortletUnit", "clearShortletSelection", "applyDiscoveryShortlist", "validatedCheckOutForNights"]) {
    assert.ok(issue.includes(name), `issue 07 names ${name}`);
  }
});
