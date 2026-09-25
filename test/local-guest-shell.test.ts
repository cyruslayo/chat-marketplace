import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalGuestApp, renderGuestShellHtml, startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { formatGuestHistorySummary, guestSurfaceStatusMessage } from "../apps/local-guest/src/conversational-shell.js";
import { SEE_ALL_DISCOVERY_EVENT } from "../apps/web-agent/src/discovery-a2ui.js";
import type { A2UIServerMessage } from "@weaver/core";

test("mobile conversation shell keeps one timeline, one workspace slot, and a text composer", () => {
  const html = renderGuestShellHtml();

  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /id="transcript"[^>]+aria-labelledby="conversation-heading"/);
  assert.match(html, /id="active-workspace"/);
  assert.match(html, /id="composer-input"/);
  assert.match(html, /id="composer-submit"/);
  assert.match(html, /<label id="composer-label" for="composer-input">Your message<\/label>/);
  assert.match(html, /id="main-content" tabindex="-1"/);
  assert.match(html, /id="announcer"[^>]+aria-live="polite"/);
  assert.match(html, /Explore Abuja/);
  assert.match(html, /Explore Lagos/);
  assert.doesNotMatch(html, /Local demo/);
  assert.match(html, /100dvh/);
  assert.match(html, /prefers-reduced-motion/);
  assert.doesNotMatch(html, /microphone|speech recognition|voice input/i);
  assert.doesNotMatch(html, /Current workspace|Search updated|replaced by a newer workspace|Use the details below to continue|>Past</);
});

test("Guest history keeps useful meaning without exposing workspace lifecycle terminology", () => {
  assert.equal(formatGuestHistorySummary("Search updated · Old Ikoyi · 2 guests", "superseded"), "Searched Old Ikoyi · 2 guests");
  assert.equal(formatGuestHistorySummary("Garden Two-Bedroom Stay in Old Ikoyi details", "superseded"), "Viewed Garden Two-Bedroom Stay in Old Ikoyi");
  assert.equal(formatGuestHistorySummary("Request Draft", "superseded"), "Prepared booking details");
  assert.match(formatGuestHistorySummary("Search updated · Lagos · 2 guests", "stale"), /Searched Lagos.*may have changed/);
  assert.match(formatGuestHistorySummary("Payment handoff", "fallback"), /hosted checkout.*details unavailable/);
  assert.equal(guestSurfaceStatusMessage("active"), "");
  assert.match(guestSurfaceStatusMessage("superseded"), /replaced and are read-only/i);
  assert.match(guestSurfaceStatusMessage("stale"), /details may have changed/i);
  assert.match(guestSurfaceStatusMessage("expired"), /expired/i);
  assert.match(guestSurfaceStatusMessage("deleted"), /no longer available/i);
  assert.doesNotMatch(guestSurfaceStatusMessage("fallback"), /workspace|fallback/i);
});

test("server-backed state restores the conversation timeline and latest workspace projection", async () => {
  const environment = new LocalGuestEnvironment({ databasePath: `.scratch/eval-test/shell_state_${Date.now()}.sqlite` });
  try {
    const app = new LocalGuestApp(environment);
    const threadId = "g-abcdef123456";
    const result = await app.handleTurn(threadId, "I need an apartment in Ikoyi for 3 nights for 2 people");
    assert.equal(result.ok, true);

    const snapshot = app.getState(threadId);
    assert.ok(snapshot);
    assert.deepEqual(snapshot.timeline.map((entry) => entry.role), ["user", "assistant"]);
    assert.equal(snapshot.timeline[0]?.text, "I need an apartment in Ikoyi for 3 nights for 2 people");
    assert.equal(snapshot.surfaces.length, 1);
    assert.equal(snapshot.surfaces[0]?.mode, "inline-surface");
    assert.match(snapshot.surfaces[0]?.summary ?? "", /Search updated.*Ikoyi.*2 guests/);

    await app.handleTurn(threadId, "I need a place");
    const afterTextOnlyTurn = app.getState(threadId);
    assert.ok(afterTextOnlyTurn);
    assert.equal(afterTextOnlyTurn.surfaces.length, 1, "text-only turns retain the active workspace for refresh");
  } finally {
    environment.close();
  }
});

test("discovery preview expands into one focused results workspace through a reversible presentation event", async () => {
  const environment = new LocalGuestEnvironment({ databasePath: `.scratch/eval-test/shell_expand_${Date.now()}.sqlite` });
  try {
    const app = new LocalGuestApp(environment);
    const threadId = "g-fedcba654321";
    const turn = await app.handleTurn(threadId, "I need an apartment in Lagos for 3 nights for 2 people");
    assert.equal(turn.ok, true);
    if (!turn.ok) return;
    const update = turn.surfaces[0]?.a2uiMessages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
    assert.ok(update);
    const button = update.updateComponents.components.find((component) => component.component === "Button" && "action" in component);
    assert.ok(button && "action" in button && button.action);
    const action = button.action as unknown as { event: { name: string; surfaceId?: string; context: unknown } };
    assert.equal(action.event.name, SEE_ALL_DISCOVERY_EVENT);
    const expanded = app.handleEvent(threadId, { ...action.event, surfaceId: turn.surfaces[0]!.surfaceId });
    assert.equal(expanded.ok, true);
    if (expanded.ok) {
      assert.equal(expanded.surfaces.length, 1);
      assert.equal(expanded.surfaces[0]?.mode, "focused-surface");
      assert.match(expanded.surfaces[0]?.surfaceId ?? "", /:discovery:focused$/);
    }
  } finally {
    environment.close();
  }
});

test("shell telemetry accepts only the registered redacted event vocabulary", () => {
  const environment = new LocalGuestEnvironment({ databasePath: `.scratch/eval-test/shell_telemetry_${Date.now()}.sqlite` });
  try {
    const app = new LocalGuestApp(environment);
    assert.equal(app.recordShellTelemetry("fallback-rendered"), true);
    assert.equal(app.recordShellTelemetry("guest-email@example.com"), false);
    const event = environment.telemetry.events().at(-1);
    assert.equal(event?.type, "interaction.fallback-rendered");
    assert.doesNotMatch(JSON.stringify(event), /guest-email|creditCard|bearerToken/i);
  } finally {
    environment.close();
  }
});

test("HTTP refresh state requires the server-issued browser session and cannot enumerate another thread", async () => {
  const environment = new LocalGuestEnvironment({ databasePath: `.scratch/eval-test/shell_http_${Date.now()}.sqlite` });
  const server = startLocalGuestServer({ port: 0, environment });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const threadId = "g-0123456789ab";
  try {
    const page = await fetch(`${base}/`);
    const cookie = page.headers.get("set-cookie");
    assert.match(cookie ?? "", /shortlet_guest_session=gs-[a-f0-9-]{36}/);

    const turn = await fetch(`${base}/api/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie!.split(";")[0]! },
      body: JSON.stringify({ threadId, text: "I need an apartment in Ikoyi for 3 nights for 2 people" }),
    });
    assert.equal(turn.status, 200);

    const restored = await fetch(`${base}/api/state?threadId=${threadId}`, { headers: { Cookie: cookie!.split(";")[0]! } });
    const restoredBody = await restored.json() as { readonly timeline?: readonly unknown[] };
    assert.equal(restored.status, 200);
    assert.equal(restoredBody.timeline?.length, 2);

    const guessed = await fetch(`${base}/api/state?threadId=g-abcdefabcdef`, { headers: { Cookie: cookie!.split(";")[0]! } });
    const guessedBody = await guessed.json() as { readonly timeline?: readonly unknown[] };
    assert.equal(guessed.status, 200);
    assert.equal(guessedBody.timeline?.length, 0);

    const unauthenticated = await fetch(`${base}/api/state?threadId=${threadId}`);
    assert.equal(unauthenticated.status, 401);

    const malformedSession = await fetch(`${base}/api/state?threadId=${threadId}`, { headers: { Cookie: "shortlet_guest_session=forged" } });
    assert.equal(malformedSession.status, 401);
  } finally {
    await server.close();
    environment.close();
  }
});
