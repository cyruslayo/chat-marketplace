import assert from "node:assert/strict";
import test from "node:test";
import { guestActionOrUndefined } from "./helpers/guest-restart.js";

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
