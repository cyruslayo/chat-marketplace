import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as guestContent from "../apps/web-agent/src/guest-content.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { clientWith, completion } from "./helpers/openai-compatible-client.js";
import {
  classifiedMessage,
  datedFixture,
  isScopeRequest,
  LIVE_LIKE_CLOCK,
  lastRoleIsTool,
  latestUserText,
  OPENROUTER,
  scopeVerdict,
  searchToolCall,
  trueRestartedDatedApp,
} from "./helpers/guest-date-fixtures.js";

const RELATIVE_TEXT = "I want a flat in Ikoyi next Friday";

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "object" && value !== null) for (const nested of Object.values(value)) stringsIn(nested, out);
  return out;
}

test("AC1: No guest-facing string contains \"YYYY-MM-DD\"", () => {
  const exported = Object.values(guestContent).filter((value) => typeof value !== "function");
  const strings = exported.flatMap((value) => stringsIn(value));
  assert.ok(strings.length > 50, "the guest copy modules export a substantial set of strings");
  for (const text of strings) assert.doesNotMatch(text, /YYYY-MM-DD/, `guest copy must not show an ISO format: ${text}`);
});

test("AC2: A relative date turn on the assistant path gets the plain-word clarification and no search runs", async () => {
  const diagnostics: AssistantDiagnosticEvent[] = [];
  // The classifier reads the guest's text; the planner proposes a check-in the guest never wrote (ADR 0106 date authority).
  const model = clientWith((request) => {
    if (isScopeRequest(request)) {
      const slots = classifiedMessage(request) === RELATIVE_TEXT ? { city: "Lagos", neighbourhood: "Ikoyi", guests: null } : {};
      return completion({ content: JSON.stringify(scopeVerdict(slots)) });
    }
    if (lastRoleIsTool(request)) return completion({ content: "Search complete." });
    if (latestUserText(request) === RELATIVE_TEXT) {
      return searchToolCall("unauthored-date", { city: "Lagos", neighbourhood: "Ikoyi", checkIn: "2026-11-20", nights: 3, guests: 2 });
    }
    throw new Error("Unexpected offline fixture turn");
  }, OPENROUTER).client;
  const threadId = "g-deadbeef26";
  const first = datedFixture(model, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  // Cold restore before the event: a new environment over the same store, with no in-memory thread state.
  const restored = trueRestartedDatedApp(first, model, diagnostics);
  restored.app.getState(threadId);
  try {
    const result = await restored.app.handleTurn(threadId, RELATIVE_TEXT);
    assert.equal(result.ok, true, "a rejected planner date is a tool denial, not CONCIERGE_UNAVAILABLE");
    assert.deepEqual(result.surfaces, []);
    assert.equal(result.messages?.[0], GUEST_ASSISTANT_COPY.datesClarification);
    assert.doesNotMatch(result.messages?.[0] ?? "", /YYYY-MM-DD/);
    assert.ok(!diagnostics.some((event) => event.stage === "application_operation" && event.succeeded), "no search ran");
    const history = restored.runtime.getThread(threadId).conversationHistory;
    assert.ok(history.some((step) => step.role === "user" && step.text === RELATIVE_TEXT), "the guest's message is preserved");
  } finally {
    restored.close();
  }
});

test("AC3: renderShortletReply has no phrase list for dates", () => {
  const source = readFileSync(new URL("../apps/local-guest/src/assistant/shortlet-assistant-pack.ts", import.meta.url), "utf8");
  const start = source.indexOf("function renderShortletReply");
  assert.ok(start >= 0, "renderShortletReply exists");
  const end = source.indexOf("\nfunction ", start + 1);
  assert.ok(end > start, "renderShortletReply is followed by another top-level function");
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /next friday|next week|next month|tomorrow/i);
});
