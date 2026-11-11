import assert from "node:assert/strict";
import test from "node:test";
import * as guestContent from "../apps/web-agent/src/guest-content.js";
import { GUEST_ASSISTANT_COPY, GUEST_FORBIDDEN_TERMS } from "../apps/web-agent/src/guest-content.js";
import { coldTurn, datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, scriptedPlanner, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";
import { coldApp, PHONE, SCRIPT, STAY_SEARCH, STAY_TEXT, successOf, tap } from "./helpers/assistant-cold-journey-harness.js";

// Issue 06 (guideline §9): internal state names, UI jargon and raw identifiers stay out of guest copy.
// The assistant path runs with the runtime enabled and a cold restore before every event (ADR 0106).

const STATUS_TEXT = "What is my booking status?";
const RAW_REFERENCE = /\b(?:request|offer|contract)\s+(?:id|reference)\b|\b(?:req|off|con)[-_][A-Za-z0-9-]{3,}\b/i;

const TURNS: Readonly<Record<string, ScriptedTurn>> = {
  [STAY_TEXT]: SCRIPT[STAY_TEXT],
  [STATUS_TEXT]: {
    slots: STAY_SEARCH,
    intents: ["status"],
    tool: { name: "get_booking_status", args: {} },
    replyAfterTool: { kind: "show_status", references: ["get_booking_status"] },
  },
};

/** Every string an exported guest-copy value produces: strings, object and array leaves, and function results. */
function collectGuestStrings(): string[] {
  const strings: string[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      strings.push(value);
      return;
    }
    if (typeof value === "function") {
      if (seen.has(value)) return;
      seen.add(value);
      const args = Array.from({ length: Math.max(0, value.length) }, () => "Sample");
      try {
        visit((value as (...parameters: unknown[]) => unknown)(...args));
      } catch {
        // A function that needs a real array or record cannot be called with samples; its other exports still sweep.
      }
      return;
    }
    if (typeof value !== "object" || value === null || value instanceof RegExp || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  for (const exported of Object.values(guestContent)) visit(exported);
  return strings;
}

function hasForbiddenTerm(text: string): boolean {
  return GUEST_FORBIDDEN_TERMS.some((term) => term.test(text));
}

test("AC1: The model-path request receipt names the request as sent and waiting for the Operator, with no raw ID in its main text", () => {
  assert.equal(GUEST_ASSISTANT_COPY.disclosedRequest, "Request sent. Waiting for the Operator to respond.");
  for (const copy of [GUEST_ASSISTANT_COPY.disclosedRequest, GUEST_ASSISTANT_COPY.confirmedBooking, GUEST_ASSISTANT_COPY.issuedOffer]) {
    assert.equal(RAW_REFERENCE.test(copy), false, copy);
  }
  // Failure path: the old receipt carries a raw id and the internal "disclosed" state name.
  const oldReceipt = "Your Booking Request req-8f3a has been disclosed and is awaiting the Accommodation Provider's response.";
  assert.equal(RAW_REFERENCE.test(oldReceipt), true);
  assert.equal(hasForbiddenTerm(oldReceipt), true);
});

test("AC2: No exported guest string contains a forbidden term, and the sweep fails when one is added", () => {
  const strings = collectGuestStrings();
  assert.ok(strings.length > 100, `the sweep visits every exported guest string (saw ${strings.length})`);
  assert.deepEqual(strings.filter(hasForbiddenTerm), []);
  // Failure path: a newly added internal term is reported, including the internal phrase "the workspace".
  assert.deepEqual(
    ["Booking Request sent", "Review it in the workspace", "This surface is out of date", "The artifact is stale"].filter(hasForbiddenTerm),
    ["Review it in the workspace", "This surface is out of date", "The artifact is stale"],
  );
});

test("AC3: An assistant-enabled cold-restore journey shows the new receipt after submit", async () => {
  const f = datedFixture(scriptedPlanner(TURNS).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d1a0000399";
    const search = successOf(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    const detail = await tap(f, threadId, search.surfaces[0]!, "View");
    const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
    const phoneAsk = await tap(f, threadId, draft.surfaces[0]!, "Review request");
    const phoneSave = firstButtonAction(phoneAsk.surfaces[0]!);
    const saved = successOf(await coldApp(f, threadId).handleEventAsync(threadId, {
      ...phoneSave,
      context: { ...phoneSave.context, contactValue: PHONE },
    }), "Save phone number");
    const sent = await tap(f, threadId, saved.surfaces[0]!, "Send booking request");
    const requestId = sent.surfaces[0]!.surfaceId.split(":").at(-1)!;

    const status = successOf(await coldTurn(f, threadId, STATUS_TEXT, scriptedPlanner(TURNS).client), "status");
    assert.deepEqual(status.messages, [GUEST_ASSISTANT_COPY.disclosedRequest]);
    assert.equal(status.messages.some((message) => message.includes(requestId)), false, "the raw request id stays out of the reply");
    assert.equal(status.messages.some(hasForbiddenTerm), false);
  } finally {
    f.close();
  }
});
