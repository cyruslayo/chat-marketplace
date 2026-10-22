import assert from "node:assert/strict";
import test from "node:test";
import { loadPilotCoreConfiguration, type PilotEnvironmentSource } from "../apps/pilot/src/pilot-config-core.js";
import { loadPilotConfiguration } from "../apps/pilot/src/pilot-config.js";
import { loadCloudflareConfiguration, type CloudflareEnv } from "../apps/cloudflare/src/cloudflare-config.js";
import { DEMO_STAGING_SOURCE, PRODUCTION_WITH_DEMO_SOURCE, STAGING_WITHOUT_DEMO_SOURCE } from "./helpers/demo-mode-fixture.js";

const asCloudflare = (source: PilotEnvironmentSource): CloudflareEnv => source as CloudflareEnv;

test("AC1: with SHORTLET_DEMO=enabled on staging, the invite code is not required and no invite gate applies", () => {
  const configuration = loadPilotCoreConfiguration(DEMO_STAGING_SOURCE);
  assert.equal(configuration.demo, true);
  assert.equal(configuration.betaInviteCode, null);
  const cloudflare = loadCloudflareConfiguration(asCloudflare(DEMO_STAGING_SOURCE));
  assert.equal(cloudflare.demo, true);
  assert.equal(cloudflare.betaInviteCode, null);
});

test("AC1 failure path: with demo off on staging, a missing invite code is still a startup error", () => {
  const withoutCode = { ...DEMO_STAGING_SOURCE, SHORTLET_DEMO: undefined };
  assert.throws(() => loadPilotCoreConfiguration(withoutCode), /SHORTLET_BETA_INVITE_CODE is required/);
  assert.throws(() => loadCloudflareConfiguration(asCloudflare(withoutCode)), /SHORTLET_BETA_INVITE_CODE is required/);
  const withCode = loadPilotCoreConfiguration(STAGING_WITHOUT_DEMO_SOURCE);
  assert.equal(withCode.demo, false);
  assert.notEqual(withCode.betaInviteCode, null);
});

test("AC2: SHORTLET_DEMO=enabled with a production deployment is a startup error in the Cloudflare loader", () => {
  assert.throws(() => loadCloudflareConfiguration(asCloudflare(PRODUCTION_WITH_DEMO_SOURCE)), /SHORTLET_DEMO is refused in production \(ADR 0105\)/);
  assert.throws(
    () => loadCloudflareConfiguration(asCloudflare({ ...PRODUCTION_WITH_DEMO_SOURCE, SHORTLET_DEPLOYMENT: "production" })),
    /SHORTLET_DEMO is refused in production \(ADR 0105\)/,
  );
});

test("AC2: SHORTLET_DEMO=enabled with a production deployment is a startup error in the Node loader", () => {
  // The refusal runs before any file is read, so no inventory or operator file is needed to reach it.
  assert.throws(() => loadPilotConfiguration(PRODUCTION_WITH_DEMO_SOURCE), /SHORTLET_DEMO is refused in production \(ADR 0105\)/);
  assert.throws(() => loadPilotCoreConfiguration(PRODUCTION_WITH_DEMO_SOURCE), /SHORTLET_DEMO is refused in production \(ADR 0105\)/);
});

test("AC2 failure path: an unrecognised SHORTLET_DEMO value fails closed in both loaders", () => {
  for (const value of ["yes", "ENABLED", "1"]) {
    assert.throws(() => loadPilotCoreConfiguration({ ...DEMO_STAGING_SOURCE, SHORTLET_DEMO: value }), /SHORTLET_DEMO must be enabled or disabled/, value);
    assert.throws(() => loadCloudflareConfiguration(asCloudflare({ ...DEMO_STAGING_SOURCE, SHORTLET_DEMO: value })), /SHORTLET_DEMO must be enabled or disabled/, value);
  }
});
