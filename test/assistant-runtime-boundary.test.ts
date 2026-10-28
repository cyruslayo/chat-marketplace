import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Issue 04 (ADR 0099): the platform names no domain. Shortlet and commerce tool names, pending-action kinds, stage names,
 * domain literals and domain imports live in their packs and stage handlers. The platform files below are scanned for each
 * pattern, and the scan must equal a NAMED allowlist exactly: a new occurrence fails, and so does a stale allowlist entry.
 * Each allowlist entry names the documented exception it covers.
 */

const PLATFORM_FILES = [
  "apps/local-guest/src/assistant/assistant-runtime.ts",
  "apps/local-guest/src/assistant/assistant-platform.ts",
  "apps/local-guest/src/assistant/assistant-stage-handler.ts",
  "apps/local-guest/src/assistant/assistant-turn-transaction.ts",
] as const;

const SHORTLET_TOOL_NAMES = [
  "search_stays", "compare_stays", "explain_stay_price", "get_booking_status", "get_offer_status", "get_unit_details",
  "prepare_request_draft", "propose_accept_offer", "propose_request_to_book", "propose_start_payment",
];
const COMMERCE_TOOL_NAMES = ["add_to_store_cart", "get_offer", "get_order_status", "propose_checkout", "quote_delivery", "search_products"];
const PENDING_ACTION_KINDS = ["request_to_book", "accept_offer", "start_checkout", "commerce.checkout.confirm"];
const STAGE_NAMES = ["discovery", "unit", "request", "offer", "payment", "booking"];

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordAlternation = (names: readonly string[]): string => `(^|[^A-Za-z0-9_])(${names.map(escapeRegex).join("|")})($|[^A-Za-z0-9_])`;

/** Each pattern names what it catches. A pattern with no allowlist entry must have zero matches in every platform file. */
const PATTERNS: readonly { readonly id: string; readonly source: string }[] = [
  { id: "shortlet tool name", source: wordAlternation(SHORTLET_TOOL_NAMES) },
  { id: "commerce tool name", source: wordAlternation(COMMERCE_TOOL_NAMES) },
  { id: "pending-action kind", source: wordAlternation(PENDING_ACTION_KINDS) },
  { id: "stage name literal", source: `["'\`](${STAGE_NAMES.join("|")}|commerce)["'\`]` },
  { id: "domain literal shortlet", source: `["'\`]shortlet["'\`]` },
  { id: "domain literal commerce", source: `["'\`]commerce["'\`]` },
  { id: "shortlet import: createShortletAssistantPack", source: `\\bcreateShortletAssistantPack\\b` },
  { id: "shortlet import: proposalStillAuthorised", source: `\\bproposalStillAuthorised\\b` },
  { id: "shortlet import: validatedCheckOutForNights", source: `\\bvalidatedCheckOutForNights\\b` },
  { id: "template stage key", source: `\\$\\{[^}]+\\}:(\\$\\{|[a-z_])` },
];

/**
 * The documented exceptions. `count` is the exact number of matches in that file. An entry marked "pending owner decision" is
 * removed by the commit that resolves it. The Shortlet public API is a follow-up issue (issue 04 decision b).
 */
const ALLOWLIST: readonly { readonly file: string; readonly pattern: string; readonly count: number; readonly label: string }[] = [
  { file: "assistant-runtime.ts", pattern: "domain literal shortlet", count: 2,
    label: "restoreShortletState's Shortlet domain check. Shortlet public API, follow-up issue (issue 04 decision b)." },
  { file: "assistant-runtime.ts", pattern: "shortlet import: createShortletAssistantPack", count: 2,
    label: "pending owner decision (issue 04 decision b): the runtime's import and its default registration. Moves to the host (ADR 0099 section 6)." },
  { file: "assistant-runtime.ts", pattern: "shortlet import: proposalStillAuthorised", count: 2,
    label: "pending owner decision (issue 04 decision b): the import and applyDiscoveryShortlist's call. Moves behind a pack hook." },
  { file: "assistant-runtime.ts", pattern: "shortlet import: validatedCheckOutForNights", count: 2,
    label: "Shortlet public API: the import and recordGuestStay's checkout derivation. Follow-up issue (issue 04 decision b, remaining Shortlet API)." },
  { file: "assistant-runtime.ts", pattern: "template stage key", count: 4,
    label: "Four surface-id templates: the platform action gate key `<pack id>:checkout` (ADR 0099 section 3); the generic projected-surface key `<pack id>:<kind>` (the commerce path, issue 04 decision a); the pending-card surface id (platform, ADR 0074); and the restored pending-card id in restoreShortletState (Shortlet public API, follow-up issue, decision b)." },
  { file: "assistant-platform.ts", pattern: "stage name literal", count: 1,
    label: "projectedSurface kind union `discovery | cart | checkout | order`: the generic projected-surface contract whose kinds commerce supplies (issue 04 decision a)." },
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

test("the platform files match the named boundary allowlist exactly (no new domain name, import or stage key; no stale entry)", () => {
  const expected = ALLOWLIST.map((entry) => `${entry.file}|${entry.pattern}|${entry.count}`).sort();
  assert.deepEqual(scan(), expected, "every platform-file match is a named, counted exception");
});

test("every allowlist entry names a documented exception", () => {
  for (const entry of ALLOWLIST) {
    assert.ok(entry.label.length > 0, `${entry.file} ${entry.pattern} needs a label`);
    assert.ok(PATTERNS.some((pattern) => pattern.id === entry.pattern), `${entry.pattern} is a known pattern`);
  }
});
