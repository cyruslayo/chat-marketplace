import assert from "node:assert/strict";
import test from "node:test";
import { rm } from "node:fs/promises";
import { loadPilotConfiguration, type PilotEnvironmentSource } from "../apps/pilot/src/pilot-config.js";
import { loadCloudflareConfiguration, cloudflareProvisioningState, type CloudflareEnv } from "../apps/cloudflare/src/cloudflare-config.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { SqliteUnitRepository } from "../domains/shortlet/src/sqlite-unit-repository.js";
import { SqliteOperatorRepository } from "../domains/shortlet/src/sqlite-operator-repository.js";
import { JsonUnitRepository } from "../domains/shortlet/src/browse.js";
import { JsonOperatorRepository } from "../domains/shortlet/src/operator.js";
import { productionFixture, PUBLIC_ORIGIN } from "./helpers/pilot-fixture.js";

const valid = { SHORTLET_PUBLIC_ORIGIN: PUBLIC_ORIGIN, SHORTLET_TENANT_ID: "tenant-pilot", PAYSTACK_SECRET_KEY: "sk_live_test-only", PAYSTACK_ENVIRONMENT: "live" };
// These tests exercise configuration, not bindings; no Cloudflare service is invoked.
const env = (source: PilotEnvironmentSource): CloudflareEnv => source as CloudflareEnv;

const invalid: readonly PilotEnvironmentSource[] = [
  { SHORTLET_PUBLIC_ORIGIN: "" }, { SHORTLET_PUBLIC_ORIGIN: "not-url" },
  ...["http://pilot.example.com", "https://user:secret@pilot.example.com", "https://pilot.example.com/path", "https://pilot.example.com/?x=1", "https://pilot.example.com/#fragment"].map(SHORTLET_PUBLIC_ORIGIN => ({ SHORTLET_PUBLIC_ORIGIN })),
  { PAYSTACK_SECRET_KEY: "" }, { PAYSTACK_ENVIRONMENT: "unknown" }, { PAYSTACK_ENVIRONMENT: "test" },
  { PAYSTACK_CALLBACK_BASE_URL: "bad" }, { PAYSTACK_CALLBACK_BASE_URL: "https://other.example.com" },
  { SHORTLET_DEPLOYMENT: "unknown" }, { SHORTLET_DEPLOYMENT: "staging" },
  { SHORTLET_BETA_INVITE_CODE: "forbidden" },
  { SHORTLET_PAYSTACK_TRANSFERS: "yes" }, { SHORTLET_RECEIPT_MAX_BYTES: "0" }, { SHORTLET_RECEIPT_MAX_BYTES: "1.5" },
  { SHORTLET_MANUAL_TRANSFER_BANK_NAME: "Bank" },
  { SHORTLET_MANUAL_TRANSFER_BANK_NAME: "Bank", SHORTLET_MANUAL_TRANSFER_ACCOUNT_NAME: "Account", SHORTLET_MANUAL_TRANSFER_ACCOUNT_NUMBER: "123" },
  ...["SHORTLET_CHAT_TURNS_PER_SESSION_PER_HOUR", "SHORTLET_CHAT_TURNS_PER_ADDRESS_PER_HOUR", "SHORTLET_NEW_SESSIONS_PER_ADDRESS_PER_HOUR", "SHORTLET_OPERATOR_LOGINS_PER_ADDRESS_PER_HOUR", "SHORTLET_GUEST_RUNTIME_IDLE_MINUTES", "CONCIERGE_DAILY_MODEL_CALL_CAP"].map(key => ({ [key]: "0" })),
  { RESEND_API_KEY: "test" },
  { RESEND_API_KEY: "test", SHORTLET_NOTIFICATION_FROM: "bad", SHORTLET_OPERATOR_ALERT_EMAILS: "ops@example.test" },
  { RESEND_API_KEY: "test", SHORTLET_NOTIFICATION_FROM: "from@example.test", SHORTLET_OPERATOR_ALERT_EMAILS: "bad" },
  { RESEND_API_KEY: "test", SHORTLET_NOTIFICATION_FROM: "from@example.test", SHORTLET_OPERATOR_ALERT_EMAILS: "ops@example.test", SHORTLET_NOTIFICATION_SWEEP_SECONDS: "0" },
  { CONCIERGE_MODE: "unknown" }, { CONCIERGE_MODE: "gemini" },
  { CONCIERGE_MODE: "gemini", GEMINI_API_KEY: "test", GEMINI_THINKING_LEVEL: "unknown" },
  { CONCIERGE_MODE: "openai-compatible" }, { CONCIERGE_FALLBACK: "unknown" }, { CONCIERGE_FALLBACK: "openai-compatible" },
  { CONCIERGE_MODE: "openai-compatible", LLM_API_KEY: "test", LLM_MODEL: "test", LLM_BASE_URL: "http://llm.example.test" },
  { CONCIERGE_MODE: "openai-compatible", LLM_API_KEY: "test", LLM_MODEL: "test", LLM_BASE_URL: "https://llm.example.test", LLM_PROVIDER_LABEL: "Unsafe label" },
];

test("AC1: loadCloudflareConfiguration refuses every invalid non-file input that loadPilotConfiguration refuses", async () => {
  const fixture = await productionFixture();
  const paths = { SHORTLET_DB_PATH: fixture.configuration.databasePath, SHORTLET_INVENTORY_PATH: fixture.configuration.inventoryPath, SHORTLET_OPERATORS_PATH: fixture.configuration.operatorsPath };
  try {
    for (const overrides of invalid) {
      const source = { ...valid, ...paths, ...overrides };
      let nodeError: unknown;
      assert.throws(() => loadPilotConfiguration(source), error => { nodeError = error; return true; });
      assert.throws(() => loadCloudflareConfiguration(env(source)), error => error instanceof Error && nodeError instanceof Error && error.message === nodeError.message);
    }
    const configuration = loadCloudflareConfiguration(env(valid));
    assert.equal(configuration.publicOrigin, PUBLIC_ORIGIN);
    assert.equal(configuration.paystackTransfersEnabled, false);
    assert.equal(configuration.receiptMaxBytes, null);
    assert.equal(configuration.notifications, null);
    assert.equal(configuration.tenantId, valid.SHORTLET_TENANT_ID);
    assert.equal("databasePath" in configuration, false);
    assert.throws(() => loadCloudflareConfiguration(env({ ...valid, SHORTLET_TENANT_ID: "" })), /SHORTLET_TENANT_ID/);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test("AC2: With PAYSTACK_CALLBACK_BASE_URL different from SHORTLET_PUBLIC_ORIGIN, loading fails", () => {
  assert.throws(() => loadCloudflareConfiguration(env({ ...valid, PAYSTACK_CALLBACK_BASE_URL: "https://other.example.test" })), /callback origin/);
  assert.equal(loadCloudflareConfiguration(env({ ...valid, PAYSTACK_CALLBACK_BASE_URL: PUBLIC_ORIGIN })).paystack.callbackBaseUrl, PUBLIC_ORIGIN);
});

test("AC3: With SHORTLET_DEPLOYMENT=staging and a live Paystack key, loading fails", () => {
  const staging = { ...valid, SHORTLET_DEPLOYMENT: "staging", SHORTLET_BETA_INVITE_CODE: "synthetic-invite" };
  assert.throws(() => loadCloudflareConfiguration(env(staging)), /Staging requires/);
  const configuration = loadCloudflareConfiguration(env({ ...staging, PAYSTACK_ENVIRONMENT: "test", PAYSTACK_SECRET_KEY: "sk_test_synthetic" }));
  assert.equal(configuration.paystack.environment, "test");
  assert.equal(configuration.betaInviteCode, staging.SHORTLET_BETA_INVITE_CODE);
});

test("AC4: process.env is never read by the Cloudflare loader; explicit env wins over conflicting process values", () => {
  const keys = ["SHORTLET_PUBLIC_ORIGIN", "PAYSTACK_ENVIRONMENT", "PAYSTACK_SECRET_KEY", "CONCIERGE_MODE"] as const;
  const saved = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = "conflicting-invalid-value";
    const configuration = loadCloudflareConfiguration(env(valid));
    assert.equal(configuration.publicOrigin, PUBLIC_ORIGIN);
    assert.equal(configuration.paystack.environment, "live");
    assert.equal(configuration.concierge.mode, "deterministic");
  } finally { keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }); }
});

test("AC5: The existing pilot-config behavior and Node path checks are preserved", async () => {
  const fixture = await productionFixture();
  try {
    const source = { ...valid, SHORTLET_DB_PATH: fixture.configuration.databasePath, SHORTLET_INVENTORY_PATH: fixture.configuration.inventoryPath, SHORTLET_OPERATORS_PATH: fixture.configuration.operatorsPath };
    assert.deepEqual(loadPilotConfiguration(source), fixture.configuration);
    assert.throws(() => loadPilotConfiguration({ ...source, SHORTLET_DB_PATH: "relative.sqlite" }), /absolute/);
    assert.throws(() => loadPilotConfiguration({ ...source, SHORTLET_INVENTORY_PATH: "missing.json" }), /absolute|existing/);
    assert.throws(() => loadPilotConfiguration({ ...source, SHORTLET_OPERATORS_PATH: "missing.json" }), /absolute|existing/);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test("First boot is not provisioned until SQLite contains valid inventory and tenant-matching operators, without demo fallback", async () => {
  const fixture = await productionFixture();
  const database = openNodeSqliteDatabase(":memory:");
  try {
    const configuration = loadCloudflareConfiguration(env(valid));
    const units = new SqliteUnitRepository(database);
    const operators = new SqliteOperatorRepository(database);
    assert.deepEqual(cloudflareProvisioningState(configuration, database), { provisioned: false });
    const unit = new JsonUnitRepository(fixture.configuration.inventoryPath).findAll()[0]!;
    const operator = new JsonOperatorRepository(fixture.configuration.operatorsPath).findAll()[0]!;
    operators.create(operator);
    assert.deepEqual(cloudflareProvisioningState(configuration, database), { provisioned: false });
    units.save(unit);
    assert.equal(cloudflareProvisioningState(configuration, database).provisioned, true);
    assert.throws(() => cloudflareProvisioningState({ ...configuration, tenantId: "other-tenant" }, database), /tenant|TENANT/);
    database.prepare("DELETE FROM operators").run();
    assert.deepEqual(cloudflareProvisioningState(configuration, database), { provisioned: false });
    operators.create({ ...operator, id: "unrelated-operator" });
    assert.throws(() => cloudflareProvisioningState(configuration, database), /Operator|operator/);
  } finally { database.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});
