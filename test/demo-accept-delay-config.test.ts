import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DEMO_ACCEPT_DELAY_SECONDS, loadPilotCoreConfiguration, type PilotEnvironmentSource } from "../apps/pilot/src/pilot-config-core.js";
import { loadCloudflareConfiguration, type CloudflareEnv } from "../apps/cloudflare/src/cloudflare-config.js";
import { DEMO_STAGING_SOURCE, STAGING_WITHOUT_DEMO_SOURCE } from "./helpers/demo-mode-fixture.js";

const asCloudflare = (source: PilotEnvironmentSource): CloudflareEnv => source as CloudflareEnv;

test("AC4: SHORTLET_DEMO_ACCEPT_DELAY_SECONDS defaults to zero, is read through the config loaders, and accepts a whole number of seconds", () => {
  assert.equal(DEFAULT_DEMO_ACCEPT_DELAY_SECONDS, 0);
  assert.equal(loadPilotCoreConfiguration(DEMO_STAGING_SOURCE).demoAcceptDelaySeconds, 0);
  assert.equal(loadCloudflareConfiguration(asCloudflare({ ...DEMO_STAGING_SOURCE, SHORTLET_DEMO_ACCEPT_DELAY_SECONDS: "45" })).demoAcceptDelaySeconds, 45);
});

test("AC4 failure path: a delay that is not a whole number of seconds fails closed at startup in both loaders", () => {
  for (const value of ["-1", "1.5", "soon", "1e3"]) {
    assert.throws(() => loadPilotCoreConfiguration({ ...DEMO_STAGING_SOURCE, SHORTLET_DEMO_ACCEPT_DELAY_SECONDS: value }), /must be a whole number of seconds/, value);
    assert.throws(() => loadCloudflareConfiguration(asCloudflare({ ...DEMO_STAGING_SOURCE, SHORTLET_DEMO_ACCEPT_DELAY_SECONDS: value })), /must be a whole number of seconds/, value);
  }
});

test("AC4 failure path: a nonzero delay is refused when the demo is off", () => {
  assert.throws(
    () => loadPilotCoreConfiguration({ ...STAGING_WITHOUT_DEMO_SOURCE, SHORTLET_DEMO_ACCEPT_DELAY_SECONDS: "30" }),
    /SHORTLET_DEMO_ACCEPT_DELAY_SECONDS requires SHORTLET_DEMO=enabled/,
  );
});
