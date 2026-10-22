/**
 * Demo-launch issue 05, AC4 and AC5 (ADR 0095: inventory only through /_ops; ADR 0075: no bearer credentials in logs).
 * Every request goes to an in-process fake of the /_ops routes. The fake uses the real operator and inventory domain
 * functions. The real CLI is run only against a local loopback server with a fake secret that never reaches Cloudflare.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { UnitRepository } from "../domains/shortlet/src/browse.js";
import { importInventoryCsv, operatorResolverFromRepository } from "../domains/shortlet/src/inventory-import.js";
import { publishUnit } from "../domains/shortlet/src/onboarding.js";
import { provisionDemo, type DemoProvisionOptions } from "../scripts/demo-provision.js";

const FAKE_SECRET = "fake-ops-secret-for-tests-only-0005";
const FAKE_ACCESS_CLIENT_SECRET = "fake-access-client-secret-0005";
const demoDirectory = join(process.cwd(), "apps/cloudflare/demo");
const now = new Date("2026-10-22T12:00:00.000Z");
const publicOrigin = "https://demo.example.test";

interface FakeOps {
  readonly operators: Map<string, Record<string, unknown>>;
  readonly units: UnitRepository;
  readonly requests: Array<{ readonly path: string; readonly status: number }>;
  readonly fetch: typeof fetch;
}

/** An in-process stand-in for the authenticated /_ops routes; it refuses a missing or wrong shared secret before any write. */
function fakeOps(secret: string): FakeOps {
  const operators = new Map<string, Record<string, unknown>>();
  const units = new UnitRepository();
  const requests: Array<{ path: string; status: number }> = [];
  const respond = (path: string, status: number, body: unknown): Response => {
    requests.push({ path, status });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const fetchFake: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (headers.get("x-shortlet-ops-secret") !== secret) return respond(url.pathname, 401, { ok: false, code: "UNAUTHORIZED" });
    const body = typeof init?.body === "string" ? init.body : "";
    if (url.pathname === "/_ops/import") {
      const parsed = JSON.parse(body) as { table: string; rows: Array<{ id: string; operator_json: string }> };
      if (parsed.table !== "operators") return respond(url.pathname, 400, { ok: false, code: "BAD_REQUEST" });
      for (const row of parsed.rows) operators.set(row.id, JSON.parse(row.operator_json) as Record<string, unknown>);
      return respond(url.pathname, 200, { ok: true, table: "operators", rows: parsed.rows.length });
    }
    if (url.pathname === "/_ops/demo/inventory/import") {
      const resolver = operatorResolverFromRepository({ findById: (id: string) => (operators.get(id) as { id: string } | undefined) ?? null });
      const result = importInventoryCsv(body, { repository: units, operatorResolver: resolver, tenantId: "tenant-staging", clock: () => now });
      if (result.invalid > 0 || result.rowsRead !== 1) return respond(url.pathname, 400, { ok: false, code: "INVALID_DEMO_INVENTORY" });
      const unitId = /^[^,]*,([^,]*)/.exec(body.split(/\r?\n/)[1] ?? "")?.[1] ?? "";
      publishUnit(units, unitId, { clock: () => now });
      return respond(url.pathname, 200, { ok: true, unitId, imported: result.imported, published: true });
    }
    return respond(url.pathname, 404, { ok: false, code: "NOT_FOUND" });
  };
  return { operators, units, requests, fetch: fetchFake };
}

function optionsFor(fake: FakeOps, secret = FAKE_SECRET, logs: string[] = []): DemoProvisionOptions {
  return {
    origin: publicOrigin,
    secret,
    accessClientId: "fake-access-client-id-0005",
    accessClientSecret: FAKE_ACCESS_CLIENT_SECRET,
    demoDirectory,
    fetch: fake.fetch,
    log: (line) => logs.push(line),
  };
}

test("AC4: provisioning imports the operator and 8 units, and a second run leaves the unit count at 8", async () => {
  const fake = fakeOps(FAKE_SECRET);
  const first = await provisionDemo(optionsFor(fake));
  assert.equal(first.ok, true, first.error ?? "");
  assert.equal(first.units, 8);
  assert.equal(fake.units.findAll().length, 8);
  assert.equal(fake.operators.size, 1);
  assert.ok(fake.units.findAll().every((unit) => unit.published === true), "units are published through the demo route");
  assert.ok(fake.units.findAll().every((unit) => unit.photoUrls.every((url) => url.startsWith(`${publicOrigin}/demo/photos/`))), "the origin is substituted at provision time");

  const second = await provisionDemo(optionsFor(fake));
  assert.equal(second.ok, true, second.error ?? "");
  assert.equal(fake.units.findAll().length, 8, "a second run updates rather than duplicates");
  assert.equal(fake.operators.size, 1, "a second run updates the operator rather than duplicating it");
});

test("AC4 failure path: without OPS_SHARED_SECRET the script makes no request and imports nothing", async () => {
  const fake = fakeOps(FAKE_SECRET);
  const result = await provisionDemo(optionsFor(fake, ""));
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /OPS_SHARED_SECRET/);
  assert.equal(fake.requests.length, 0);
  assert.equal(fake.units.findAll().length, 0);
});

test("AC4 failure path: with a wrong secret the script exits non-zero and imports nothing", async () => {
  const fake = fakeOps(FAKE_SECRET);
  const result = await provisionDemo(optionsFor(fake, "wrong-secret-0005"));
  assert.equal(result.ok, false);
  assert.equal(fake.requests.every((request) => request.status === 401), true);
  assert.equal(fake.units.findAll().length, 0);
  assert.equal(fake.operators.size, 0);
});

test("AC4 failure path: a non-HTTPS remote origin is refused before any request", async () => {
  const fake = fakeOps(FAKE_SECRET);
  const result = await provisionDemo({ ...optionsFor(fake), origin: "http://demo.example.test" });
  assert.equal(result.ok, false);
  assert.equal(fake.requests.length, 0);
});

test("AC5: the provisioner never prints or logs the shared secret or the Access client secret", async () => {
  const fake = fakeOps(FAKE_SECRET);
  const logs: string[] = [];
  const success = await provisionDemo(optionsFor(fake, FAKE_SECRET, logs));
  const failure = await provisionDemo(optionsFor(fakeOps(FAKE_SECRET), "wrong-secret-0005", logs));
  const everything = [...logs, success.error ?? "", failure.error ?? ""].join("\n");
  assert.equal(everything.includes(FAKE_SECRET), false);
  assert.equal(everything.includes(FAKE_ACCESS_CLIENT_SECRET), false);
  assert.equal(everything.includes("wrong-secret-0005"), false);
  assert.match(logs.join("\n"), /Units published: 8/, "the summary prints counts only");
});

test("AC5: the CLI exits non-zero, prints no secret and writes no file when the secret is missing or wrong", async () => {
  const server = await loopbackOps(FAKE_SECRET);
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    const missing = await runProvisionCli(["--origin", origin], { OPS_SHARED_SECRET: "" });
    assert.notEqual(missing.code, 0);
    assert.equal(server.requests, 0, "no request is sent without a secret");

    const wrong = await runProvisionCli(["--origin", origin], { OPS_SHARED_SECRET: "wrong-secret-0005" });
    assert.notEqual(wrong.code, 0);
    assert.equal(server.requests, 1, "only the first, refused request is sent");
    assert.equal(`${missing.output}${wrong.output}`.includes("wrong-secret-0005"), false);
    assert.equal(`${missing.output}${wrong.output}`.includes(FAKE_SECRET), false);
  } finally {
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
});

test("AC4 CLI: a non-loopback http origin is refused by the CLI with a non-zero exit", async () => {
  const result = await runProvisionCli(["--origin", "http://demo.example.test"], { OPS_SHARED_SECRET: FAKE_SECRET });
  assert.notEqual(result.code, 0);
  assert.equal(`${result.output}`.includes(FAKE_SECRET), false);
});

async function loopbackOps(secret: string): Promise<{ readonly server: Server; readonly port: number; requests: number }> {
  const state = { requests: 0 };
  const server = createServer((request, response) => {
    state.requests += 1;
    const authorized = request.headers["x-shortlet-ops-secret"] === secret;
    response.writeHead(authorized ? 200 : 401, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: authorized }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("loopback server did not start");
  return {
    server,
    port: address.port,
    get requests() { return state.requests; },
  } as { readonly server: Server; readonly port: number; requests: number };
}

function runProvisionCli(args: readonly string[], env: Record<string, string>): Promise<{ readonly code: number | null; readonly output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts/demo-provision.ts"), ...args], {
      env: { ...process.env, ...env, CF_ACCESS_CLIENT_SECRET: FAKE_ACCESS_CLIENT_SECRET, CF_ACCESS_CLIENT_ID: "fake-access-client-id-0005" },
      cwd: process.cwd(),
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("close", (code) => resolve({ code, output }));
  });
}

test("AC4 contract: the operators and inventory files are readable from the demo directory", () => {
  assert.ok(readFileSync(join(demoDirectory, "operators.csv"), "utf8").includes("demo-operator-001"));
  assert.ok(readFileSync(join(demoDirectory, "inventory.csv"), "utf8").includes("demo-unit-"));
});
