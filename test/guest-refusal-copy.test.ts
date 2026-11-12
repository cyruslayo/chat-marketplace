import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { GUEST_PAYMENT_COPY, GUEST_REFUSAL, GUEST_REFUSAL_DEFAULT, guestRefusalFor } from "../apps/web-agent/src/guest-content.js";
import { firstButtonAction } from "./helpers/guest-date-fixtures.js";
import { restartFixture } from "./helpers/guest-restart.js";

// Issue 60 (ADR 0075, ADR 0077): refusals show guest copy, and every `ok:false` code maps to a closed class. The guard test greps every
// code the app can emit and asserts the map covers it; the served tests check the mapped copy and class leave /api/turn and /api/event.

const ROOT = join(import.meta.dirname, "..");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function emittedCodes(): Set<string> {
  const sources = [
    join(ROOT, "apps/local-guest/src/shortlet-app.ts"),
    ...files(join(ROOT, "apps/local-guest/src/assistant")),
    ...readdirSync(join(ROOT, "apps/web/src")).filter((name) => name.endsWith("-actions.ts")).map((name) => join(ROOT, "apps/web/src", name)),
    join(ROOT, "packages/platform-core/src/interactions.ts"),
  ];
  const codes = new Set<string>();
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    // Literal `code: "…"` returns.
    for (const match of text.matchAll(/code:\s*"([A-Z][A-Z_]+)"/g)) codes.add(match[1]!);
    // `error: "…"` literals (for example TASK_UNAVAILABLE, returned through a variable elsewhere).
    for (const match of text.matchAll(/error:\s*"([A-Z][A-Z_]+)"/g)) codes.add(match[1]!);
    // String `*_CODE` constants returned as a code (for example THREAD_BUSY_CODE).
    for (const match of text.matchAll(/(?:export\s+)?const\s+[A-Z][A-Z0-9_]*_CODE\s*=\s*"([A-Z][A-Z_]+)"/g)) codes.add(match[1]!);
    // Every member of a closed `*RejectionCode` union.
    for (const union of text.matchAll(/type\s+\w*RejectionCode\s*=\s*([\s\S]*?);/g)) {
      for (const member of union[1]!.matchAll(/"([A-Z][A-Z_]+)"/g)) codes.add(member[1]!);
    }
  }
  return codes;
}

test("AC1: every `ok:false` code the app emits has a GUEST_REFUSAL entry", () => {
  const codes = emittedCodes();
  assert.ok(codes.size >= 20, `the grep found the emitted codes (saw ${codes.size})`);
  const missing = [...codes].filter((code) => (GUEST_REFUSAL as Readonly<Record<string, unknown>>)[code] === undefined);
  assert.deepEqual(missing, [], `codes without a refusal entry: ${missing.join(", ")}`);
});

test("AC2: a stale refusal served over HTTP shows the stale copy with refusal stale and no developer text", async () => {
  const fixture = await restartFixture();
  try {
    const turn = await fixture.send("/api/turn", { text: "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people" });
    assert.equal(turn.ok, true, turn.ok ? "" : `${turn.code} ${turn.message}`);
    if (!turn.ok) throw new Error("unreachable");
    const card = turn.surfaces.find((surface) => /:discovery:/.test(surface.surfaceId));
    assert.ok(card, "the search shows a discovery card");
    const action = firstButtonAction(card);
    const forged = await fixture.send("/api/event", { ...action, context: { ...action.context, artifactId: "search_forged" } }) as { readonly ok: boolean; readonly code?: string; readonly message?: string; readonly refusal?: string };
    assert.equal(forged.ok, false);
    assert.equal(forged.refusal, "stale");
    assert.equal(forged.message, GUEST_REFUSAL_DEFAULT.stale);
    assert.doesNotMatch(String(forged.message), /authoritative|artifact|context is invalid/i);
  } finally { await fixture.close(); }
});

test("AC3: an unknown code returns the generic copy with refusal unavailable", () => {
  assert.deepEqual(guestRefusalFor("NOT_A_REAL_CODE"), { class: "unavailable", message: GUEST_REFUSAL_DEFAULT.unavailable });
});

test("AC4: REQUEST_NOT_SUBMITTED no longer echoes the domain error message", () => {
  // Its server message is a fixed guest sentence, now kept instead of replaced by the generic copy (`message: null` means keep it).
  assert.deepEqual(guestRefusalFor("REQUEST_NOT_SUBMITTED"), { class: "unavailable", message: null });
  const source = readFileSync(join(ROOT, "apps/local-guest/src/shortlet-app.ts"), "utf8");
  assert.doesNotMatch(source, /code: "REQUEST_NOT_SUBMITTED", message \}/, "the raw error message is not returned");
  assert.match(source, /code: "REQUEST_NOT_SUBMITTED", message: "The Booking Request could not be submitted/, "a fixed guest sentence is returned");
});

test("AC5: a code whose server message is closed guest copy keeps it instead of losing it to the generic copy", () => {
  // These server messages are authored guest copy (ADR 0075/0077); the map must not replace them. `message: null` tells the exit to
  // keep the result's own message. ACTION_NOT_AUTHORIZED carries the closed payment message on the card-checkout failure.
  const closedGuestCopy = [
    "CARD_CHECKOUT_FAILED", "PAYMENT_NOT_CONFIRMED", "PAYSTACK_UNAVAILABLE",
    "REQUEST_NOT_SUBMITTED", "CONCIERGE_UNAVAILABLE", "UNKNOWN_DOMAIN",
    "CRITERIA_REJECTED", "CRITERIA_LOCKED", "CONTINUOUS_OCCUPANCY_REFUSED", "NOTHING_TO_UNDO",
  ] as const;
  for (const code of closedGuestCopy) {
    assert.equal(guestRefusalFor(code).message, null, `${code} keeps its server-authored message`);
  }
});

test("AC6: ACTION_NOT_AUTHORIZED keeps only closed guest copy and replaces internal text with the forbidden copy", () => {
  // The card-checkout sentence is named guest copy (ADR 0077) and is kept.
  assert.deepEqual(guestRefusalFor("ACTION_NOT_AUTHORIZED", GUEST_PAYMENT_COPY.checkoutStartFailed), { class: "forbidden", message: null });
  // Internal server messages are replaced by the fixed forbidden copy.
  assert.deepEqual(guestRefusalFor("ACTION_NOT_AUTHORIZED", "Offer cannot be accepted in current state."), { class: "forbidden", message: GUEST_REFUSAL_DEFAULT.forbidden });
  assert.deepEqual(guestRefusalFor("ACTION_NOT_AUTHORIZED", "The requested action is not authorized."), { class: "forbidden", message: GUEST_REFUSAL_DEFAULT.forbidden });
  // With no message, it also gets the forbidden copy.
  assert.deepEqual(guestRefusalFor("ACTION_NOT_AUTHORIZED"), { class: "forbidden", message: GUEST_REFUSAL_DEFAULT.forbidden });
});
