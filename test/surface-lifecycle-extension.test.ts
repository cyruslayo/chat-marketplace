import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GenerativeSurfaceManager } from "../packages/platform-core/src/surface.js";

test("surface expiry is evaluated lazily against the current clock", () => {
  let now = new Date("2026-09-04T10:00:00Z");
  const manager = new GenerativeSurfaceManager({ clock: () => now });
  const surface = manager.createSurface({ catalogue: "discovery/v1", expiresAtIso: "2026-09-04T10:01:00Z" });

  assert.equal(manager.getSurface(surface.surfaceId).status, "active");
  now = new Date("2026-09-04T10:01:00Z");
  assert.equal(manager.getSurface(surface.surfaceId).status, "expired");
  assert.throws(() => manager.executeSurfaceAction(surface.surfaceId, { actionName: "view" }), /Action authority revoked: surface is expired/);
});

test("superseded and deleted surfaces retain their records but cannot execute actions", () => {
  const manager = new GenerativeSurfaceManager();
  const superseded = manager.createSurface({ catalogue: "discovery/v1" });
  manager.supersedeSurface(superseded.surfaceId);
  assert.equal(manager.getSurface(superseded.surfaceId).status, "superseded");
  assert.throws(() => manager.executeSurfaceAction(superseded.surfaceId, { actionName: "view" }), /Action authority revoked: surface is superseded/);

  const deleted = manager.createSurface({ catalogue: "discovery/v1" });
  manager.deleteSurface(deleted.surfaceId);
  assert.equal(manager.getSurface(deleted.surfaceId).status, "deleted");
  assert.throws(() => manager.executeSurfaceAction(deleted.surfaceId, { actionName: "view" }), /Action authority revoked: surface is deleted/);
});

test("canonical surface manager types do not use any", () => {
  const source = readFileSync(new URL("../packages/platform-core/src/surface.ts", import.meta.url), "utf8");
  assert.equal(source.includes("any"), false);
});
