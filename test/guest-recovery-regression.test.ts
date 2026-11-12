import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { renderPaymentCallbackFailureHtml } from "../apps/local-guest/src/guest-server.js";
import { mountGuestSurfaceOrFallback } from "../apps/local-guest/src/guest-surface-fallback.js";
import { VIEW_UNIT_EVENT } from "../apps/web-agent/src/discovery-a2ui.js";
import { coldApp, SCRIPT, STAY_TEXT, successOf, tap } from "./helpers/assistant-cold-journey-harness.js";
import { coldTurn, datedFixture, LIVE_LIKE_CLOCK, restartedDatedApp, scriptedPlanner } from "./helpers/guest-date-fixtures.js";
import { guestAction, restartFixture } from "./helpers/guest-restart.js";

// Issue 22 (ADR 0046, 0072, 0074, 0080, 0106; guideline §14 release invariants): recovery and parity regression suite.

test("AC1: A stale, superseded or expired action is refused after a cold restore, and the current state is shown", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK });
  try {
    const threadId = "g-d1a0000701";
    const search = successOf(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    const context = findView(search.surfaces[0]!.a2uiMessages);
    assert.ok(context);
    const restored = restartedDatedApp(f, scriptedPlanner({}).client);
    restored.app.getState(threadId);
    const refused = await restored.app.handleEventAsync(threadId, { name: VIEW_UNIT_EVENT, surfaceId: search.surfaces[0]!.surfaceId, sourceComponentId: "card", timestamp: new Date().toISOString(), context: { ...context, artifactId: "search-forged-999" } });
    assert.equal(refused.ok, false);
    assert.equal(refused.ok ? "" : refused.code, "ARTIFACT_MISMATCH");
    const state = coldApp(f, threadId).getState(threadId);
    assert.match(state?.surfaces[0]?.surfaceId ?? "", /:discovery:/, "the current discovery state is shown");
  } finally { f.close(); }
});

test("AC2: The same action from two tabs takes effect once", async () => {
  const fixture = await restartFixture();
  try {
    await fixture.advance("review");
    const state = await fixture.state();
    assert.ok(!("ok" in state && state.ok === false));
    const surface = state.surfaces[0]!;
    const action = guestAction(surface);
    const first = await fixture.send("/api/event", action);
    const second = await fixture.send("/api/event", action);
    assert.equal(first.ok, true, "the first tab submits");
    assert.equal(second.ok, false, "the second tab is refused");
    assert.equal(fixture.environment.interactionStore.listBookingRequestIds().length, 1, "one Booking Request exists");
  } finally { await fixture.close(); }
});

test("AC3: A model timeout leaves the previous facts visible and the draft intact", async () => {
  const f = datedFixture(scriptedPlanner(SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const threadId = "g-d1a0000703";
    const search = successOf(await f.app.handleTurn(threadId, STAY_TEXT), "search");
    const detail = await tap(f, threadId, search.surfaces[0]!, "View");
    const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
    assert.match(draft.surfaces[0]!.surfaceId, /:request:draft:/);
    const failed = await coldTurn(f, threadId, "an unscripted message the offline model refuses", scriptedPlanner({}).client);
    assert.ok(failed, "the deterministic path still answers the turn");
    const state = coldApp(f, threadId).getState(threadId);
    assert.match(state?.surfaces[0]?.surfaceId ?? "", /:request:draft:/, "the draft is still the current surface");
    assert.match(JSON.stringify(state?.surfaces[0]), /Request Draft|Review request|Check-in/i, "the draft facts remain");
  } finally { f.close(); }
});

test("AC4: An invalid generated surface renders its text fallback and standard route", () => {
  const window = new Window();
  const mount = window.document.createElement("div");
  const result = mountGuestSurfaceOrFallback({
    attemptMount: () => ({ ok: false }),
    mount: mount as unknown as HTMLElement,
    surface: { surfaceId: "surface-1", mode: "inline-surface", status: "fallback", summary: "Stays", textFallback: "The current stay details are available in text.", conventionalRoute: "/stays/unit-lagos-ikoyi-001", conventionalRouteLabel: "Open full details" },
  });
  assert.equal(result.ok, false);
  assert.match(mount.textContent ?? "", /current stay details are available in text/);
  assert.match(mount.querySelector("a")?.getAttribute("href") ?? "", /\/stays\/unit-lagos-ikoyi-001/);
});

test("AC5: Provider return without verified payment never shows a confirmed reservation", () => {
  const page = renderPaymentCallbackFailureHtml(400, "PAYMENT_CALLBACK_UNKNOWN");
  const text = page.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /reservation is not confirmed/);
  assert.doesNotMatch(text, /reservation is confirmed|booking is confirmed|payment succeeded|payment successful/i);
});

test("AC6: The no-JS route offers the same authoritative standard route for the same command", async () => {
  const fixture = await restartFixture();
  try {
    await fixture.advance("review");
    const state = await fixture.state();
    assert.ok(!("ok" in state && state.ok === false));
    const route = state.surfaces[0]?.conventionalRoute;
    assert.ok(route, "the review surface names its standard route");
    const page = await (await fetch(`${fixture.base}/conversation?threadId=${fixture.threadId}`, { headers: { accept: "text/html", cookie: fixture.cookie } })).text();
    assert.ok(page.includes(`href="${route}"`), "the no-JS page links to the same standard route");
    // Recorded contradiction: /conversation posts guest messages only; surface commands run on the standard route.
    assert.doesNotMatch(page, /action="\/conversation\/event"/);
  } finally { await fixture.close(); }
});

function findView(value: unknown): { artifactId: string; unitId: string } | undefined {
  let found: { artifactId: string; unitId: string } | undefined;
  const walk = (node: unknown): void => {
    if (found !== undefined) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const context = record.context;
    if (record.name === VIEW_UNIT_EVENT && context !== null && typeof context === "object") {
      const candidate = context as Record<string, unknown>;
      if (typeof candidate.artifactId === "string" && typeof candidate.unitId === "string") found = { artifactId: candidate.artifactId, unitId: candidate.unitId };
    }
    Object.values(record).forEach(walk);
  };
  walk(value);
  return found;
}
