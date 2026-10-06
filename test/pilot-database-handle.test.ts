import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { startPilotServer } from "../apps/pilot/src/pilot-server.js";
import { startLocalPilotServer } from "../apps/pilot/src/local-pilot-server.js";
import { bootstrapLocalPilot, localPilotPaths } from "../apps/pilot/src/local-pilot.js";
import { LocalApartmentOwnerEnvironment } from "../apps/local-owner/src/local-owner-environment.js";
import { SqliteGuestAccountAuthority } from "../domains/shortlet/src/guest-account-authority.js";
import { nodeSqlitePathOpenCount } from "../packages/platform-core/src/node-sqlite-database.js";
import { productionFixture } from "./helpers/pilot-fixture.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { EmailMessage, EmailSender } from "../apps/pilot/src/notifications/email-sender.js";

const ADAPTER = "packages/platform-core/src/node-sqlite-database.ts";
const NODE_SQLITE_IMPORT = /(?:from\s+|import\s*\(\s*)["']node:sqlite["']|import\(\s*["']node:sqlite["']\s*\)/;

function typeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (name === "node_modules" || name === "dist") return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? typeScriptFiles(path) : name.endsWith(".ts") ? [path] : [];
  });
}

const silentSender: EmailSender = { send: async (_message: EmailMessage) => undefined };

function directNodeSqliteImports(root: string): string[] {
  return ["apps", "domains", "packages"]
    .flatMap((directory) => (existsSync(join(root, directory)) ? typeScriptFiles(join(root, directory)) : []))
    .map((file) => relative(root, file).replaceAll("\\", "/"))
    .filter((file) => file !== ADAPTER)
    .filter((file) => NODE_SQLITE_IMPORT.test(readFileSync(join(root, file), "utf8")));
}

test("02e AC1: Only node-sqlite-database.ts imports node:sqlite in production code", () => {
  const offenders = directNodeSqliteImports(join(import.meta.dirname, ".."));
  assert.deepEqual(offenders, [], `Direct node:sqlite imports outside ${ADAPTER}: ${offenders.join(", ")}`);
});

test("02e AC1: the guard fails, naming the file, when a direct import is added", async () => {
  const root = await mkdtemp(join(tmpdir(), "sql-import-guard-"));
  try {
    mkdirSync(join(root, "apps", "example"), { recursive: true });
    writeFileSync(join(root, "apps", "example", "direct.ts"), ["import { DatabaseSync } from \"node:sqlite\";", "export const open = DatabaseSync;"].join("; "));
    writeFileSync(join(root, "apps", "example", "lazy.ts"), "export const load = () => import(\"node:sqlite\");");
    writeFileSync(join(root, "apps", "example", "clean.ts"), "import { openNodeSqliteDatabase } from \"./node-sqlite-database.js\";");
    assert.deepEqual(directNodeSqliteImports(root).sort(), ["apps/example/direct.ts", "apps/example/lazy.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("02e AC2: No component opens a second connection to the pilot database", async () => {
  const fixture = await productionFixture({ environment: { RESEND_API_KEY: "re_offline", SHORTLET_NOTIFICATION_FROM: "bookings@shortlet.example", SHORTLET_OPERATOR_ALERT_EMAILS: "ops@shortlet.example" } });
  const before = nodeSqlitePathOpenCount();
  const server = startPilotServer({ port: 0, configuration: fixture.configuration, paystackClient: fixture.paystack, emailSender: silentSender });
  try {
    // One handle for the guest composition and one for the owner composition (04a/04b inject a single shared handle).
    // The notifier and the healthcheck add none.
    assert.ok(server.notifier, "notifications are configured, so the notifier exists");
    await server.listen();
    assert.equal(nodeSqlitePathOpenCount() - before, 2);
  } finally {
    await server.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("02e AC3: The owner environment now enforces foreign keys, the same as the guest environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "owner-foreign-keys-"));
  const environment = new LocalApartmentOwnerEnvironment({ databasePath: join(directory, "owner.sqlite"), seedFixture: false });
  try {
    const authority = new SqliteGuestAccountAuthority(environment.database, { codeHashingKey: "owner-foreign-key-test-key" });
    assert.ok(authority);
    assert.throws(
      () => environment.database.prepare(
        "INSERT INTO guest_sign_in_codes (challenge_id, code_hash, tenant_id, email_normalized, purpose, account_guest_id, created_at, expires_at) VALUES ('c-1', 'h', 'tenant-1', 'a@example.test', 'sign_in', 'missing-account', '2026-10-06T00:00:00.000Z', '2026-10-07T00:00:00.000Z')",
      ).run(),
      /FOREIGN KEY/i,
    );
  } finally {
    environment.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("02e AC4: The healthcheck reuses the shared handle and answers 200, or 503 when the database is closed", async () => {
  const fixture = await productionFixture();
  const server = startPilotServer({ port: 0, configuration: fixture.configuration, paystackClient: fixture.paystack });
  try {
    const port = await server.listen();
    const opened = nodeSqlitePathOpenCount();
    const healthy = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), { ok: true });
    assert.equal(nodeSqlitePathOpenCount(), opened, "a healthcheck opens no new connection");
    server.guest.environment.close();
    const unhealthy = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(unhealthy.status, 503);
    assert.deepEqual(await unhealthy.json(), { ok: false });
  } finally {
    await server.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("02e AC4: the local pilot healthcheck reuses the shared handle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "local-pilot-health-"));
  const paths = localPilotPaths(directory);
  bootstrapLocalPilot(paths);
  const server = startLocalPilotServer({ port: 0, paths });
  try {
    const port = await server.listen();
    const opened = nodeSqlitePathOpenCount();
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(nodeSqlitePathOpenCount(), opened);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
