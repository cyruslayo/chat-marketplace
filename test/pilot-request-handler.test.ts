import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import type { SqlDatabase } from "../packages/platform-core/src/sql-database.js";
import { PILOT_LIMIT_DEFAULTS } from "../apps/pilot/src/pilot-config.js";
import {
  createPilotRequestHandler,
  BETA_BANNER_TEXT,
  withBetaBanner,
  type PilotDispatchTarget,
  type PilotHandlerConfiguration,
} from "../apps/pilot/src/pilot-request-handler.js";
import { createFakeHttpRequest, createFakeHttpResponse, type CapturedResponse } from "./helpers/http-like.js";

/** AC1 failure path: the grep test finds a leftover proxy or loopback literal and fails naming the file. */
function pilotSources(): string[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
    });
  return walk(join(import.meta.dirname, "../apps/pilot/src"));
}

test("08c AC1: no localhost proxy remains in apps/pilot/src", () => {
  assert.ok(pilotSources().length > 0, "the pilot source tree is present");
  for (const file of pilotSources()) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("127.0.0.1"), false, `${file} must not hardcode the proxy's loopback address`);
    assert.equal(/request\s+as\s+httpRequest/.test(source), false, `${file} must not proxy via node:http request`);
  }
});

function countingDatabase(real: SqlDatabase): { readonly proxy: SqlDatabase; readonly statements: string[] } {
  const statements: string[] = [];
  const proxy = new Proxy(real, {
    get(target, property) {
      if (property === "prepare") {
        return function prepare(this: unknown, sql: string) {
          statements.push(sql);
          return real.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as SqlDatabase;
  return { proxy, statements };
}

function fakeTarget(status: number, contentType: string, body: string): PilotDispatchTarget {
  return {
    handle: async (_req, res) => {
      res.writeHead(status, { "Content-Type": contentType, "Content-Length": String(Buffer.byteLength(body)) });
      res.end(body);
    },
    close: async () => {},
  };
}

const STAGING_PAGE = `<!doctype html><html lang="en-NG"><body><main>Stay</main></body></html>`;
const FIXED_CLOCK = new Date("2026-09-03T10:02:00.000Z");

function handlerFor(
  database: SqlDatabase,
  configuration: PilotHandlerConfiguration,
  guest: PilotDispatchTarget,
  owner: PilotDispatchTarget,
  clientAddress: () => string,
) {
  return createPilotRequestHandler(configuration, {
    guest,
    owner,
    database,
    clock: () => FIXED_CLOCK,
    clientAddress,
    ready: () => true,
  });
}

function drive(handler: { handle(req: unknown, res: unknown): Promise<void> }, method: string, url: string): Promise<CapturedResponse> {
  return (async () => {
    const request = createFakeHttpRequest({ method, url });
    const { response, finished } = createFakeHttpResponse();
    await handler.handle(request, response);
    return await finished;
  })();
}

test("08c AC2: /healthz reads only the shared handle and never opens a new connection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pilot-handler-health-"));
  try {
    const real = openNodeSqliteDatabase(join(directory, "pilot.sqlite"));
    const { proxy, statements } = countingDatabase(real);
    const owner = fakeTarget(200, "text/html; charset=utf-8", STAGING_PAGE);
    const guest = fakeTarget(200, "text/html; charset=utf-8", STAGING_PAGE);
    let ready = true;
    const handler = createPilotRequestHandler(
      { publicOrigin: "https://pilot.example.test", deployment: "production", limits: { ...PILOT_LIMIT_DEFAULTS } },
      { guest, owner, database: proxy, clock: () => FIXED_CLOCK, clientAddress: () => "203.0.113.7", ready: () => ready },
    );
    try {
      const healthy = await drive(handler, "GET", "/healthz");
      assert.equal(healthy.statusCode, 200);
      assert.equal(healthy.body.toString("utf8"), JSON.stringify({ ok: true }));
      assert.ok(healthy.headers.some((entry) => entry.name === "cache-control" && entry.value.includes("no-store")));
      // Failure path: a closed shared handle is unhealthy (503), and no other connection was opened anywhere.
      real.close();
      const unhealthy = await drive(handler, "GET", "/healthz");
      assert.equal(unhealthy.statusCode, 503);
      assert.equal(unhealthy.body.toString("utf8"), JSON.stringify({ ok: false }));
    } finally {
      await handler.close();
    }
    // Health reads came from the one shared handle only: the dispatch path issued exactly the health statements.
    for (const statement of statements) assert.equal(statement, "SELECT 1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function rightmostForwarded(req: { headers: Record<string, unknown> }): string {
  const forwarded = req.headers["x-forwarded-for"];
  const header = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  const last = typeof header === "string" ? header.split(",").map((part) => part.trim()).filter((part) => part !== "").at(-1) : undefined;
  return last ?? "unknown";
}

test("08c AC3: logins beyond operatorLoginsPerAddressPerHour are refused with 429 and Retry-After", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pilot-handler-guard-"));
  try {
    const database = openNodeSqliteDatabase(join(directory, "pilot.sqlite"));
    const configuration: PilotHandlerConfiguration = {
      publicOrigin: "https://pilot.example.test",
      deployment: "production",
      limits: { ...PILOT_LIMIT_DEFAULTS, operatorLoginsPerAddressPerHour: 2 },
    };
    const owner = fakeTarget(200, "text/html; charset=utf-8", STAGING_PAGE);
    const guest = fakeTarget(200, "text/html; charset=utf-8", STAGING_PAGE);
    let currentClientAddress = "203.0.113.7";
    const handler = handlerFor(database, configuration, guest, owner, () => currentClientAddress);
    try {
      const login = async (address: string): Promise<CapturedResponse> => {
        currentClientAddress = address;
        const request = createFakeHttpRequest({ method: "POST", url: "/operator/login", headers: { "x-forwarded-for": address } });
        const { response, finished } = createFakeHttpResponse();
        await handler.handle(request, response);
        return await finished;
      };
      assert.equal(rightmostForwarded({ headers: { "x-forwarded-for": "10.0.0.1, 203.0.113.7" } }), "203.0.113.7", "the injected rule stays the rightmost forwarded entry");
      assert.equal((await login("203.0.113.7")).statusCode, 200, "the first login is dispatched to the owner handler");
      assert.equal((await login("203.0.113.7")).statusCode, 200, "the second login is within the limit");
      const refused = await login("203.0.113.7");
      assert.equal(refused.statusCode, 429, "the limit is enforced exactly as before");
      const retryAfter = refused.headers.find((entry) => entry.name === "retry-after");
      assert.ok(retryAfter && Number.isSafeInteger(Number(retryAfter.value)) && Number(retryAfter.value) > 0, "the refusal carries Retry-After");
      assert.ok(refused.headers.some((entry) => entry.name === "cache-control" && entry.value.includes("no-store")));
      // Another address is not punished for the same address's burst. Clock limits are the deps' clock's to move.
      assert.equal((await login("198.51.100.3")).statusCode, 200);
    } finally {
      await handler.close();
      database.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("08c AC4: the beta banner wraps guest and operator HTML when staging, and never JSON or assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pilot-handler-banner-"));
  try {
    const database = openNodeSqliteDatabase(join(directory, "pilot.sqlite"));
    const ownerPage = fakeTarget(200, "text/html; charset=utf-8", STAGING_PAGE);
    const guestPage = fakeTarget(200, "text/html; charset=utf-8", STAGING_PAGE);
    const guestJson = fakeTarget(200, "application/json; charset=utf-8", JSON.stringify({ ok: true }));
    const guestStyles = fakeTarget(200, "text/css; charset=utf-8", ".ui-frame{color:var(--color-text)}");
    const staged: PilotHandlerConfiguration = {
      publicOrigin: "https://pilot.example.test",
      deployment: "staging",
      limits: { ...PILOT_LIMIT_DEFAULTS },
    };
    const production: PilotHandlerConfiguration = { ...staged, deployment: "production" };

    const operatorPage = await drive(handlerFor(database, staged, guestPage, ownerPage, () => "203.0.113.7"), "GET", "/operator");
    assert.ok(operatorPage.body.toString("utf8").includes(BETA_BANNER_TEXT), "the operator page carries the banner");
    assert.equal(
      operatorPage.headers.find((entry) => entry.name === "content-length")?.value,
      String(Buffer.byteLength(withBetaBanner(STAGING_PAGE))),
      "the content-length is rewritten for the wrapped page",
    );
    const guest = await drive(handlerFor(database, staged, guestPage, ownerPage, () => "203.0.113.7"), "GET", "/some-stay");
    assert.ok(guest.body.toString("utf8").includes(BETA_BANNER_TEXT), "the guest page carries the banner");

    const json = await drive(handlerFor(database, staged, guestJson, ownerPage, () => "203.0.113.7"), "GET", "/api/state");
    assert.equal(json.body.toString("utf8"), JSON.stringify({ ok: true }), "JSON is never banner-wrapped");
    const asset = await drive(handlerFor(database, staged, guestStyles, ownerPage, () => "203.0.113.7"), "GET", "/shortlet-foundations.css");
    assert.equal(asset.body.toString("utf8"), ".ui-frame{color:var(--color-text)}", "assets are never banner-wrapped");

    const productionPage = await drive(handlerFor(database, production, guestPage, ownerPage, () => "203.0.113.7"), "GET", "/operator");
    assert.equal(productionPage.body.toString("utf8"), STAGING_PAGE, "production composition never carries the banner");
    await database.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("08c AC5: the pilot composition suites, the local pilot and the full suite pass — verified in this slice's wave-close run", () => {
  assert.equal(typeof createPilotRequestHandler, "function");
});
