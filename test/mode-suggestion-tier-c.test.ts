import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { ShortletAssistantRuntime } from "./helpers/assistant-runtime-host.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { parseScopeAssessment } from "../apps/local-guest/src/assistant/scope-classifier.js";
import { modeSwitchTier } from "../apps/local-guest/src/assistant/mode-switch-tier.js";
import { ASSISTANT_CONTROL_COPY } from "../apps/local-guest/src/assistant/control-copy.js";
import { TASK_START_EVENT } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { GUEST_MODE_SUGGESTION } from "../apps/web-agent/src/guest-content.js";
import { SqliteTelemetry } from "../packages/platform-core/src/sqlite-telemetry.js";
import { datedFixture, LIVE_LIKE_CLOCK, restartedDatedApp } from "./helpers/guest-date-fixtures.js";
import { clientWith, completion } from "./helpers/openai-compatible-client.js";
import { classifiedMessage, isScopeRequest, scopeVerdict } from "./helpers/guest-date-fixtures.js";

const empty = { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null };
function verdict(scope: "in_scope" | "out_of_scope" | "unclear", targetPack: string | null) {
  return { scope, targetPack, risk: "ordinary", intents: scope === "in_scope" ? ["greet"] : [], reasonCode: scope === "in_scope" ? "supported" : scope === "out_of_scope" ? "outside" : "unclear", slots: empty };
}
function runtime(assess: (text: string) => unknown = () => verdict("out_of_scope", "shop")) {
  const environment = LocalGuestEnvironment.openNode({ databasePath: ":memory:", clock: LIVE_LIKE_CLOCK, initialGuestPhoneNumber: null, initialGuestContactEmail: null });
  const assistant = new ShortletAssistantRuntime(environment, new ScriptedAssistantModel([]), { additionalPacks: [createFakeShopPack()], scopeClassifier: { assess: async (text) => assess(text) } });
  return { environment, assistant };
}

test("AC1: A verdict whose target is not a registered pack id becomes null and gets the fixed redirect", async () => {
  assert.equal(parseScopeAssessment(verdict("out_of_scope", "forged"), undefined, ["shortlet", "shop"])?.targetPack, null);
  const { assistant, environment } = runtime(() => verdict("out_of_scope", "forged"));
  const reply = await assistant.handleTurn("fresh-ac1", "buy a kettle");
  assert.deepEqual(reply.messages, [ASSISTANT_CONTROL_COPY.redirect]);
  assert.equal(reply.modeChange, undefined);
  environment.close();
});

test("AC2: An in-scope turn containing another pack's keyword gets no suggestion and no keyword match", async () => {
  let assessed = 0;
  const { assistant, environment } = runtime(() => { assessed++; return verdict("in_scope", "shop"); });
  const reply = await assistant.handleTurn("fresh-ac2", "shop around for a stay");
  assert.equal(assessed, 1);
  assert.equal(reply.modeChange, undefined);
  assert.equal(reply.quickReplies?.length ?? 0, 0);
  assert.doesNotMatch(reply.messages?.join(" ") ?? "", /Start a Shop search/);
  environment.close();
});

test("AC3: An out-of-scope turn with valid target and tier C suggests once without changing the active task", async () => {
  const { assistant, environment } = runtime();
  const before = assistant.getThread("fresh-ac3").activeTaskId;
  const reply = await assistant.handleTurn("fresh-ac3", "buy a kettle");
  assert.deepEqual(reply.modeChange, { from: "shortlet", to: "shop", reason: "suggested", undoable: false });
  assert.deepEqual(reply.quickReplies, [{ label: GUEST_MODE_SUGGESTION.chip("Shop"), domain: "shop" }]);
  assert.deepEqual(reply.messages, [GUEST_MODE_SUGGESTION.message("Shop")]);
  assert.equal(assistant.getThread("fresh-ac3").activeTaskId, before);
  environment.close();
});

test("AC4: With an open proposal a suggestion keeps the pending proposal", async () => {
  const { assistant, environment } = runtime();
  const thread = assistant.getThread("fresh-ac4");
  const proposal: NonNullable<typeof thread.taskState.pendingAction> = { id: "pending-test", threadId: "fresh-ac4", guestActorId: "guest", tenantId: "tenant", type: "give_notice", authoritativeReferences: {}, summary: "Review notice", createdAt: LIVE_LIKE_CLOCK().toISOString(), expiresAt: "2026-10-28T10:00:00Z", executed: false };
  thread.taskState.pendingAction = proposal;
  const reply = await assistant.handleTurn("fresh-ac4", "buy a kettle");
  assert.equal(reply.modeChange?.reason, "suggested");
  assert.equal(assistant.getThread("fresh-ac4").taskState.pendingAction, proposal);
  environment.close();
});

test("AC5: Disabled A and B still suggest even without risk; injected enabled tiers are represented", () => {
  assert.equal(modeSwitchTier({ scope: "out_of_scope", targetPack: "shop", packAtRisk: true, tiersEnabled: { A: false, B: false, C: true } }), "C");
  assert.equal(modeSwitchTier({ scope: "out_of_scope", targetPack: "shop", packAtRisk: false, tiersEnabled: { A: false, B: false, C: true } }), "C");
  assert.equal(modeSwitchTier({ scope: "out_of_scope", targetPack: "shop", packAtRisk: false, tiersEnabled: { A: false, B: true, C: true } }), "B");
  assert.equal(modeSwitchTier({ scope: "out_of_scope", targetPack: "shop", packAtRisk: false, freshTask: true, tiersEnabled: { A: true, B: true, C: true } }), "A");
});

test("AC6: An unclear verdict with a target or classifier failure never suggests or switches", async () => {
  for (const assess of [() => verdict("unclear", "shop"), () => { throw new Error("unavailable"); }, () => verdict("out_of_scope", null)]) {
    const { assistant, environment } = runtime(assess);
    const before = assistant.getThread("fresh-ac6").activeTaskId;
    const reply = await assistant.handleTurn("fresh-ac6", "unsure");
    assert.equal(reply.modeChange, undefined);
    assert.equal(reply.quickReplies?.some((chip) => "domain" in chip) ?? false, false);
    assert.equal(assistant.getThread("fresh-ac6").activeTaskId, before);
    environment.close();
  }
});

test("AC7: The mode-change diagnostic contains only closed fields and no id, text or token", async () => {
  const { assistant, environment } = runtime();
  await assistant.handleTurn("fresh-ac7", "private guest words");
  const event = (environment.telemetry as SqliteTelemetry).events().find((item) => item.type === "assistant.mode.change.v1");
  assert.deepEqual(event, { type: "assistant.mode.change.v1", from: "shortlet", to: "shop", reason: "suggested", tier: "C", undone: false, recordedAt: event?.recordedAt });
  assert.doesNotMatch(JSON.stringify(event), /fresh-ac7|private guest words|token/i);
  environment.close();
});

test("AC8: After a manual switch away from stays a later out-of-scope turn suggests, never automatically switches back", async () => {
  const model = clientWith((request) => {
    if (!isScopeRequest(request)) return completion({ content: JSON.stringify({ kind: "clarify_stay", references: [] }) });
    return completion({ content: JSON.stringify(classifiedMessage(request) === "hello"
      ? { ...scopeVerdict({}, ["greet"]), targetPack: null }
      : { ...scopeVerdict({}, []), scope: "out_of_scope", reasonCode: "outside", targetPack: "shortlet" }) });
  });
  const fixture = datedFixture(model.client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true, additionalPacks: [createFakeShopPack()] });
  try {
    const threadId = "g-d1a00003f08";
    assert.equal((await fixture.app.handleTurn(threadId, "hello")).ok, true);
    const switchApp = restartedDatedApp(fixture, model.client, undefined, [createFakeShopPack()]).app;
    switchApp.getState(threadId);
    const selected = await switchApp.handleEventAsync(threadId, { name: TASK_START_EVENT, surfaceId: `thread-${threadId}:tasks`, sourceComponentId: "task-rail", timestamp: LIVE_LIKE_CLOCK().toISOString(), context: { domain: "shop" } });
    assert.equal(selected.ok, true);
    const turnApp = restartedDatedApp(fixture, model.client, undefined, [createFakeShopPack()]).app;
    turnApp.getState(threadId);
    const reply = await turnApp.handleTurn(threadId, "a stay please");
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(reply.mode?.id, "shop", "the manual choice stays active");
    assert.equal(reply.modeChange?.to, "shortlet");
    assert.equal(reply.quickReplies?.[0]?.domain, "shortlet");
    const after = restartedDatedApp(fixture, model.client, undefined, [createFakeShopPack()]).app.getState(threadId);
    assert.equal(after?.mode?.id, "shop", "a cold restore keeps the manually chosen mode");
  } finally { fixture.close(); }
});

test("AC9: The rendered suggestion chip uses the kit's 44-by-44 touch target", () => {
  const client = readFileSync(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
  assert.match(client, /button\.className = "ui-chip quick-reply"/);
  assert.match(css, /\.ui-chip\s*\{[^}]*min-block-size:\s*var\(--control-min-target\)/s);
  assert.match(css, /--control-min-target:\s*2\.75rem/);
});

test("AC10: Accepting the chip starts the target task; only the event changes the response mode across cold restores", async () => {
  const model = clientWith((request) => isScopeRequest(request)
    ? completion({ content: JSON.stringify(classifiedMessage(request) === "hello" ? { ...scopeVerdict({}, ["greet"]), targetPack: null } : { ...scopeVerdict({}, []), scope: "out_of_scope", reasonCode: "outside", targetPack: "shop" }) })
    : completion({ content: JSON.stringify({ kind: "clarify_stay", references: [] }) }));
  const fixture = datedFixture(model.client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true, additionalPacks: [createFakeShopPack()] });
  try {
    const threadId = "g-d1a00003f10";
    const initial = await fixture.app.handleTurn(threadId, "hello");
    assert.equal(initial.ok, true, JSON.stringify(initial));
    const first = restartedDatedApp(fixture, model.client, undefined, [createFakeShopPack()]).app;
    first.getState(threadId);
    const suggested = await first.handleTurn(threadId, "buy a kettle");
    assert.equal(suggested.ok, true, JSON.stringify(suggested));
    if (!suggested.ok) return;
    assert.equal(suggested.mode?.id, "stays");
    assert.equal(suggested.quickReplies?.[0]?.domain, "shop");
    const classifierCall = model.requests.find((request) => isScopeRequest(request));
    const format = classifierCall?.body.response_format as { json_schema?: { schema?: { properties?: { targetPack?: { enum?: unknown[] } } } } } | undefined;
    assert.deepEqual(format?.json_schema?.schema?.properties?.targetPack?.enum, ["shortlet", "shop", null], "the schema enumerates only registered pack ids");
    const second = restartedDatedApp(fixture, model.client, undefined, [createFakeShopPack()]).app;
    second.getState(threadId);
    const switched = await second.handleEventAsync(threadId, { name: TASK_START_EVENT, surfaceId: `thread-${threadId}:tasks`, sourceComponentId: "task-rail", timestamp: LIVE_LIKE_CLOCK().toISOString(), context: { domain: "shop" } });
    assert.equal(switched.ok, true, JSON.stringify(switched));
    if (switched.ok) assert.equal(switched.mode?.id, "shop");
  } finally { fixture.close(); }
});
