import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guestActionOrUndefined, restartFixture } from "./helpers/guest-restart.js";

// Demo-launch issue 13 round 4: the guest fixture driver must step through a surface that waits for the operator
// (no action button) without throwing an AssertionError. Building that error reads source and blocks the event loop for
// seconds, after which pooled keep-alive sockets are reset. Local test data only.

function surfaceWithButton(eventName: string) {
  return {
    surfaceId: "surface-button",
    a2uiMessages: [{ version: "v0.9.1", updateComponents: { surfaceId: "surface-button", components: [{ id: "go", component: "Button", action: { event: { name: eventName, context: { step: 1 } } } }] } }],
  } as unknown as Parameters<typeof guestActionOrUndefined>[0];
}

test("A surface with an action button yields its event name and context", () => {
  const action = guestActionOrUndefined(surfaceWithButton("continue"));
  assert.ok(action);
  assert.equal(action.name, "continue");
  assert.deepEqual(action.context, { step: 1 });
  assert.equal(action.surfaceId, "surface-button");
});

test("A surface waiting for the operator, with no action button, yields undefined without throwing", () => {
  const waiting = { surfaceId: "surface-waiting", a2uiMessages: [{ version: "v0.9.1", updateComponents: { surfaceId: "surface-waiting", components: [{ id: "status", component: "Text", text: "Waiting for the operator." }] } }] } as unknown as Parameters<typeof guestActionOrUndefined>[0];
  const started = Date.now();
  assert.equal(guestActionOrUndefined(waiting), undefined);
  assert.ok(Date.now() - started < 500, "no assertion message is built for a waiting surface");
});

test("A surface with no UI update yields undefined without throwing", () => {
  const empty = { surfaceId: "surface-empty", a2uiMessages: [] } as unknown as Parameters<typeof guestActionOrUndefined>[0];
  assert.equal(guestActionOrUndefined(empty), undefined);
});

test("A fixture whose startup throws leaves no temporary directory behind", async () => {
  const isolated = mkdtempSync(join(tmpdir(), "restart-isolated-"));
  const names = ["TMPDIR", "TEMP", "TMP", "NODE_ENV", "COMMERCE_REFERENCE_HMAC_KEY", "COMMERCE_REFERENCE_HMAC_KEY_ID", "COMMERCE_REFERENCE_TEST_KEY"] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    // No payment reference key pair and no test-only opt-in, so the local guest refuses to start (ADR 0075).
    for (const name of names) delete process.env[name];
    process.env.TMPDIR = isolated; process.env.TEMP = isolated; process.env.TMP = isolated;
    await assert.rejects(restartFixture());
    assert.deepEqual(readdirSync(isolated), []);
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    }
    rmSync(isolated, { recursive: true, force: true });
  }
});
