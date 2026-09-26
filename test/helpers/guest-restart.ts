import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { A2UIServerMessage } from "@weaver/core";
import { LocalGuestEnvironment, type LocalGuestFixtureConfig } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer, type GuestStateSnapshot, type GuestSurfacePayload, type GuestTurnResult, type GuestTurnSuccess } from "../../apps/local-guest/src/guest-server.js";

/** The surface's first action button, or the one that sends `name`. */
export function guestAction(surface: GuestSurfacePayload, name?: string) {
  const update = surface.a2uiMessages.find((message): message is Extract<A2UIServerMessage, { updateComponents: unknown }> => "updateComponents" in message);
  assert.ok(update);
  const components = update.updateComponents.components as readonly { component: string; action?: { event?: { name?: unknown; context?: unknown } } }[];
  const event = components.find((component) => component.component === "Button" && component.action?.event && (name === undefined || component.action.event.name === name))?.action?.event;
  assert.ok(event && typeof event.name === "string" && event.context && typeof event.context === "object");
  return { name: event.name, context: event.context, surfaceId: surface.surfaceId, sourceComponentId: "restart-test", timestamp: new Date().toISOString() };
}

export const stages = ["discovery", "inspection", "draft", "review", "pending", "offer", "payment-ready", "handoff", "deposit-ready", "deposit-handoff", "confirmed"] as const;
export type RestartStage = typeof stages[number];

type GuestServerOptions = Omit<NonNullable<Parameters<typeof startLocalGuestServer>[0]>, "port" | "environment">;

export async function restartFixture(config: Partial<LocalGuestFixtureConfig> = {}, serverOptions: GuestServerOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), "guest-restart-"));
  const databasePath = join(directory, "guest.sqlite");
  let now = new Date("2026-09-03T10:00:00Z");
  let server = startLocalGuestServer({ ...serverOptions, port: 0, environment: new LocalGuestEnvironment({ ...config, databasePath, clock: () => now }) });
  let base = `http://127.0.0.1:${await server.listen()}`;
  const home = await fetch(base);
  const cookie = home.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  await home.text();
  const threadId = `g-${crypto.randomUUID()}`;
  const send = async (path: string, body: unknown, credential = cookie): Promise<GuestTurnResult> => {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie: credential }, body: JSON.stringify({ threadId, ...body as Record<string, unknown> }) });
    return await response.json() as GuestTurnResult;
  };
  const state = async (credential = cookie): Promise<GuestStateSnapshot | { ok: false; code: string }> => {
    const response = await fetch(`${base}/api/state?threadId=${threadId}`, { headers: { cookie: credential } });
    return await response.json() as GuestStateSnapshot | { ok: false; code: string };
  };
  let result: GuestTurnSuccess | undefined;
  const actions: ReturnType<typeof guestAction>[] = [];
  return {
    databasePath, directory, cookie, threadId, actions, send, state,
    get environment() { return server.environment; },
    get base() { return base; },
    get app() { return server.app; },
    setTime(value: string) { now = new Date(value); },
    async advance(target: RestartStage, onStage?: (stage: RestartStage, result: GuestTurnSuccess) => void | Promise<void>, text = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people") {
      const discovery = await send("/api/turn", { text });
      assert.equal(discovery.ok, true);
      result = discovery;
      await onStage?.("discovery", result);
      for (let index = 1; index <= stages.indexOf(target); index++) {
        if (stages[index] === "offer") {
          const requestId = result.surfaces[0]!.surfaceId.split(":").at(-1)!;
          server.environment.simulateOperatorAcceptance(requestId);
          const current = await state(); assert.equal(current.ok, true);
          result = { ok: true, messages: [], surfaces: current.surfaces };
        } else {
          const action = guestAction(result.surfaces[0]!); actions.push(action);
          const next = await send("/api/event", action);
          assert.equal(next.ok, true);
          result = next;
        }
        await onStage?.(stages[index]!, result);
      }
      return result;
    },
    async restart(overrides: Partial<LocalGuestFixtureConfig> = {}) {
      await server.close();
      // A new server, environment, repositories, managers and connections. No
      // application instance or runtime map is retained across this boundary.
      server = startLocalGuestServer({ ...serverOptions, port: 0, environment: new LocalGuestEnvironment({ ...config, ...overrides, databasePath, clock: () => now }) });
      base = `http://127.0.0.1:${await server.listen()}`;
      const response = await fetch(base, { headers: { cookie } });
      await response.text();
    },
    async close() { await server.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

export async function proveStage(stage: RestartStage) {
  const fixture = await restartFixture();
  try {
    const before = await fixture.advance(stage);
    const surface = before.surfaces[0]!;
    await fixture.restart();
    const restored = await fixture.state();
    assert.equal(restored.ok, true);
    assert.equal(restored.surfaces[0]?.surfaceId, surface.surfaceId);
    assert.equal(restored.surfaces[0]?.summary, surface.summary);
    const second = await fixture.state();
    assert.deepEqual(second, restored, "restoration must not run another command or change the projection");
  } finally { await fixture.close(); }
}
