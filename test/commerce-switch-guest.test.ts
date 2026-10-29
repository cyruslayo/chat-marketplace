import assert from "node:assert/strict";
import test from "node:test";
import { restartFixture } from "./helpers/guest-restart.js";
import { COMMERCE_KEYS_UNSET, COMMERCE_SYNTHETIC_KEYS, withProcessEnv } from "./helpers/commerce-switch-env.js";
import { GUEST_COMMERCE_COMPOSITION } from "../apps/local-guest/src/guest-server.js";

// ADR 0104: with the switch OFF the local guest composes no commerce. The commerce routes are not mounted, so they 404.

const COMMERCE_ROUTES = ["/s/x", "/orders/track"] as const;

async function statusesOf(base: string): Promise<Record<string, number>> {
  const statuses: Record<string, number> = {};
  for (const path of COMMERCE_ROUTES) statuses[path] = (await fetch(`${base}${path}`)).status;
  return statuses;
}

test("ADR 0104: with the switch unset, no key pair and no test opt-in, the default guest starts and its commerce routes 404", async () => {
  await withProcessEnv({ COMMERCE_ENABLED: undefined, NODE_ENV: undefined, ...COMMERCE_KEYS_UNSET }, async () => {
    const fixture = await restartFixture();
    try {
      assert.deepEqual(await statusesOf(fixture.base), { "/s/x": 404, "/orders/track": 404 });
    } finally {
      await fixture.close();
    }
  });
});

test("ADR 0104: with the switch set to \"false\" the default guest also starts without keys and 404s the commerce routes", async () => {
  await withProcessEnv({ COMMERCE_ENABLED: "false", NODE_ENV: undefined, ...COMMERCE_KEYS_UNSET }, async () => {
    const fixture = await restartFixture();
    try {
      assert.deepEqual(await statusesOf(fixture.base), { "/s/x": 404, "/orders/track": 404 });
    } finally {
      await fixture.close();
    }
  });
});

test("ADR 0104: an unrecognised switch value fails the default guest start and names COMMERCE_ENABLED", async () => {
  await withProcessEnv({ COMMERCE_ENABLED: "1", NODE_ENV: undefined, ...COMMERCE_KEYS_UNSET }, async () => {
    await assert.rejects(restartFixture(), (error: unknown) => error instanceof Error && error.message.includes("COMMERCE_ENABLED"));
  });
});

test("ADR 0075: COMMERCE_ENABLED=true without the key pair fails the start and names both missing variables, not any value", async () => {
  await withProcessEnv({ COMMERCE_ENABLED: "true", NODE_ENV: undefined, ...COMMERCE_KEYS_UNSET }, async () => {
    await assert.rejects(restartFixture(), (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      return message.includes("COMMERCE_REFERENCE_HMAC_KEY") && message.includes("COMMERCE_REFERENCE_HMAC_KEY_ID");
    });
  });
});

test("ADR 0104 decision 6: COMMERCE_ENABLED=true with no injected commerce module fails closed, names COMMERCE_ENABLED and never echoes a value", async () => {
  await withProcessEnv({ COMMERCE_ENABLED: "true", NODE_ENV: undefined, COMMERCE_REFERENCE_TEST_KEY: undefined, ...COMMERCE_SYNTHETIC_KEYS }, async () => {
    await assert.rejects(restartFixture({}, { commerceModule: undefined }), (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      return message.includes("COMMERCE_ENABLED") && !message.includes(COMMERCE_SYNTHETIC_KEYS.COMMERCE_REFERENCE_HMAC_KEY) && !message.includes("true");
    });
  });
});

test("COMMERCE_ENABLED=true with the key pair mounts the commerce routes", async () => {
  await withProcessEnv({ COMMERCE_ENABLED: "true", NODE_ENV: undefined, COMMERCE_REFERENCE_TEST_KEY: undefined, ...COMMERCE_SYNTHETIC_KEYS }, async () => {
    const fixture = await restartFixture();
    try {
      const statuses = await statusesOf(fixture.base);
      assert.notEqual(statuses["/orders/track"], 404);
    } finally {
      await fixture.close();
    }
  });
});

test("An explicit composition \"local\" is honoured without the switch (test-only fallback under the test runner)", async () => {
  await withProcessEnv({ COMMERCE_ENABLED: undefined, NODE_ENV: "test", COMMERCE_REFERENCE_TEST_KEY: "allow", COMMERCE_REFERENCE_HMAC_KEY: undefined, COMMERCE_REFERENCE_HMAC_KEY_ID: undefined }, async () => {
    const fixture = await restartFixture({}, { commerce: GUEST_COMMERCE_COMPOSITION.local });
    try {
      assert.notEqual((await statusesOf(fixture.base))["/orders/track"], 404);
    } finally {
      await fixture.close();
    }
  });
});

test("An explicit composition \"disabled\" wins over a switch that is ON", async () => {
  await withProcessEnv({ COMMERCE_ENABLED: "true", NODE_ENV: undefined, COMMERCE_REFERENCE_TEST_KEY: undefined, ...COMMERCE_SYNTHETIC_KEYS }, async () => {
    const fixture = await restartFixture({}, { commerce: GUEST_COMMERCE_COMPOSITION.disabled });
    try {
      assert.deepEqual(await statusesOf(fixture.base), { "/s/x": 404, "/orders/track": 404 });
    } finally {
      await fixture.close();
    }
  });
});
