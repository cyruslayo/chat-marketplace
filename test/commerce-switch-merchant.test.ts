import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { merchantPaymentReferenceKeysFromEnv } from "../apps/local-merchant/src/merchant-startup.js";
import { COMMERCE_SYNTHETIC_KEYS } from "./helpers/commerce-switch-env.js";

// ADR 0104: the merchant back office refuses to start while commerce is OFF, and requires the key pair when it is ON.

const KEYS = { COMMERCE_REFERENCE_HMAC_KEY: COMMERCE_SYNTHETIC_KEYS.COMMERCE_REFERENCE_HMAC_KEY, COMMERCE_REFERENCE_HMAC_KEY_ID: COMMERCE_SYNTHETIC_KEYS.COMMERCE_REFERENCE_HMAC_KEY_ID };

test("ADR 0104: the merchant refuses to start when the switch is unset, empty or \"false\", and names COMMERCE_ENABLED", () => {
  for (const env of [{}, { COMMERCE_ENABLED: "" }, { COMMERCE_ENABLED: "false" }]) {
    assert.throws(() => merchantPaymentReferenceKeysFromEnv({ ...KEYS, ...env }), (error: unknown) => error instanceof Error && error.message.includes("COMMERCE_ENABLED"));
  }
});

test("ADR 0104: the merchant refuses an unrecognised switch value and names COMMERCE_ENABLED", () => {
  assert.throws(() => merchantPaymentReferenceKeysFromEnv({ ...KEYS, COMMERCE_ENABLED: "yes" }), (error: unknown) => error instanceof Error && error.message.includes("COMMERCE_ENABLED"));
});

test("ADR 0075: with the switch ON the merchant requires the key pair and names the missing variables", () => {
  assert.throws(() => merchantPaymentReferenceKeysFromEnv({ COMMERCE_ENABLED: "true" }), (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    return message.includes("COMMERCE_REFERENCE_HMAC_KEY") && message.includes("COMMERCE_REFERENCE_HMAC_KEY_ID");
  });
});

test("ADR 0075: with the switch ON and the key pair the merchant receives the reference keys", () => {
  assert.deepEqual(merchantPaymentReferenceKeysFromEnv({ COMMERCE_ENABLED: "true", ...KEYS }), {
    currentKeyId: COMMERCE_SYNTHETIC_KEYS.COMMERCE_REFERENCE_HMAC_KEY_ID,
    currentKey: COMMERCE_SYNTHETIC_KEYS.COMMERCE_REFERENCE_HMAC_KEY,
  });
});

test("ADR 0104: the merchant entry point exits with a named refusal when the switch is OFF, before it listens", () => {
  const directory = mkdtempSync(join(tmpdir(), "merchant-switch-off-"));
  try {
    const env: Record<string, string | undefined> = { ...process.env, ...KEYS };
    delete env.COMMERCE_ENABLED;
    const run = spawnSync(process.execPath, ["--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
      resolve("apps/local-merchant/src/cli-start.ts")], { cwd: directory, env, encoding: "utf8", timeout: 60_000 });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /COMMERCE_ENABLED/);
    assert.doesNotMatch(run.stdout, /Merchant back office: http/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
