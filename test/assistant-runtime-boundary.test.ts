import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Issue 04 (ADR 0099): the platform runtime names no domain. Shortlet and commerce tool names, pending-action kinds and stage
 * names live in their packs and stage handlers. A new name added to the runtime fails this test, so the boundary stays
 * enforced by the build rather than by review.
 */

const RUNTIME_SOURCE = readFileSync(new URL("../apps/local-guest/src/assistant/assistant-runtime.ts", import.meta.url), "utf8");

const SHORTLET_TOOL_NAMES = [
  "search_stays", "compare_stays", "explain_stay_price", "get_booking_status", "get_offer_status", "get_unit_details",
  "prepare_request_draft", "propose_accept_offer", "propose_request_to_book", "propose_start_payment",
];
const COMMERCE_TOOL_NAMES = ["add_to_store_cart", "get_offer", "get_order_status", "propose_checkout", "quote_delivery", "search_products"];
const PENDING_ACTION_KINDS = ["request_to_book", "accept_offer", "start_checkout", "commerce.checkout.confirm"];
/** Stage names are quoted in source. Quoted only, so an ordinary word in a comment does not trip the test. */
const STAGE_NAMES = ["discovery", "unit", "request", "offer", "payment", "booking", "commerce"];

function namesFound(names: readonly string[], quoted: boolean): string[] {
  return names.filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = quoted ? new RegExp(`["'\`]${escaped}["'\`]`) : new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`);
    return pattern.test(RUNTIME_SOURCE);
  });
}

test("assistant-runtime.ts contains no shortlet or commerce tool names, pending-action kinds or stage names", () => {
  assert.deepEqual(namesFound(SHORTLET_TOOL_NAMES, false), []);
  assert.deepEqual(namesFound(COMMERCE_TOOL_NAMES, false), []);
  assert.deepEqual(namesFound(PENDING_ACTION_KINDS, false), []);
  assert.deepEqual(namesFound(STAGE_NAMES, true), []);
});
