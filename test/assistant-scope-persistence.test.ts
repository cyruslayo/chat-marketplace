import test from "node:test";
import assert from "node:assert/strict";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalGuestApp } from "../apps/local-guest/src/shortlet-app.js";
import { AssistantRuntime } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ShortletAssistantRuntime } from "./helpers/assistant-runtime-host.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { approvedTestScope } from "./helpers/assistant-scope.js";
import { temporaryDatabasePath } from "./helpers/temporary-database.js";

test("Context AC3 integration: rejected model call and raw step stay absent after remote persistence and cold start", async (t) => {
  const authority = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath("context-authority.sqlite") });
  t.after(() => authority.close());
  const remoteEnvironment = () => new LocalGuestEnvironment(authority.config, {
    database: authority.database, unitRepository: authority.unitRepository,
    guestData: authority.guestData, guestDataIsRemote: true,
  });
  const env = remoteEnvironment();
  t.after(() => env.close());
  const classifier = { assess: async () => ({ scope: "in_scope" as const, risk: "ordinary" as const, intents: ["search" as const], reasonCode: "supported",
    slots: { city: "Lagos", neighbourhood: "Old Ikoyi", bedrooms: null, nights: 2, guests: 2, checkIn: null, checkOut: null } }) };
  let first = true;
  const runtime = new ShortletAssistantRuntime(env, { generate: async () => {
    if (first) { first = false; return { toolCalls: [{ id: "bad-call", name: "poison-tool-name", args: { guestId: "private-guest" } }], rawStep: [{ type: "model_output", content: [{ type: "text", text: "RAW-STEP-POISON" }] }] }; }
    return { text: JSON.stringify({ kind: "clarify_stay", references: [] }) };
  } }, { scopeClassifier: classifier });
  const app = new LocalGuestApp(env, { assistantRuntime: runtime });
  const thread = `g-${crypto.randomUUID()}`;
  await app.handleTurn(thread, "Find Ikoyi stays for two nights");
  const saved = await authority.guestData.findThread(thread);
  assert.ok(saved);
  assert.doesNotMatch(saved.threadJson, /poison-tool-name|private-guest|RAW-STEP-POISON/);

  const restarted = remoteEnvironment();
  t.after(() => restarted.close());
  const requests: string[] = [];
  const freshRuntime = new ShortletAssistantRuntime(restarted, { generate: async (request) => {
    requests.push(JSON.stringify(request));
    return { text: JSON.stringify({ kind: "clarify_stay", references: [] }) };
  } }, { scopeClassifier: approvedTestScope });
  const freshApp = new LocalGuestApp(restarted, { assistantRuntime: freshRuntime });
  await freshApp.handleTurn(thread, "Find another stay");
  assert.doesNotMatch(requests.join("\n"), /poison-tool-name|private-guest|RAW-STEP-POISON/);
});

test("Scope AC6 integration: rejected input stays absent through remote-port persistence and a fresh application", async (t) => {
  const authority = LocalGuestEnvironment.openNode({ databasePath: temporaryDatabasePath("scope-authority.sqlite") });
  t.after(() => authority.close());
  const remoteEnvironment = () => new LocalGuestEnvironment(authority.config, {
    database: authority.database, unitRepository: authority.unitRepository,
    guestData: authority.guestData, guestDataIsRemote: true,
  });
  const env = remoteEnvironment();
  t.after(() => env.close());
  const runtime = new ShortletAssistantRuntime(env, new ScriptedAssistantModel(), { scopeClassifier: {
    assess: async () => ({ scope: "out_of_scope", risk: "ordinary", intents: [], reasonCode: "outside",
      slots: { city: null, neighbourhood: null, bedrooms: null, nights: null, guests: null, checkIn: null, checkOut: null } }),
  } });
  const app = new LocalGuestApp(env, { assistantRuntime: runtime });
  const thread = `g-${crypto.randomUUID()}`;
  const rejected = await app.handleTurn(thread, "Write POISON-REHYDRATION code");
  assert.equal(rejected.ok, true);
  const saved = await authority.guestData.findThread(thread);
  assert.ok(saved);
  assert.doesNotMatch(saved.threadJson, /POISON-REHYDRATION/);

  const restarted = remoteEnvironment();
  t.after(() => restarted.close());
  const requests: string[] = [];
  const offline = new ScriptedAssistantModel();
  const freshRuntime = new ShortletAssistantRuntime(restarted, { generate: async (request) => {
    requests.push(JSON.stringify(request));
    return offline.generate(request);
  } }, { scopeClassifier: approvedTestScope });
  const freshApp = new LocalGuestApp(restarted, { assistantRuntime: freshRuntime });
  const result = await freshApp.handleTurn(thread, "Find Ikoyi stays for 2 nights for 2 guests");
  assert.equal(result.ok, true);
  assert.ok(requests.length > 0);
  assert.doesNotMatch(requests.join("\n"), /POISON-REHYDRATION/);
  assert.doesNotMatch((await authority.guestData.findThread(thread))?.threadJson ?? "", /POISON-REHYDRATION/);
});
