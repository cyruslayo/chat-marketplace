import { env, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import { DurableObjectSqlDatabase } from "../src/do-sql-database.js";
import { commerceMigrationClient } from "../src/do-clients.js";
import { createOpsHandler, type OpsRouteDependencies } from "../src/ops-routes.js";
import type { CloudflareEnv } from "../src/cloudflare-config.js";
import { ORIGIN, SECRET, TENANT, opsStub } from "./ops-test-helpers.js";

/** Issue 24 review 6: Shortlet ops must not depend on the commerce object (the likely cause of the data-migration timeouts). */

const AUTH = { "cf-access-jwt-assertion": "anything", "x-shortlet-ops-secret": SECRET };

/** A commerce authority that fails every call, as a missing binding or a failing commerce object would. */
const failingCommerce = { request: async (): Promise<never> => { throw new Error("commerce is down"); } };

/**
 * Runs `run` with the real Shortlet ops handler over the object's own SQL (the storage handle belongs to the object, so every
 * request must run inside it). Commerce is supplied by the caller; marker writes are recorded so a test can prove none ran.
 */
async function withShortletOps<T>(
  commerceMigration: { request: (operation: "status" | "verify" | "cutover" | "rows") => Promise<unknown> },
  markerWrites: string[],
  run: (handler: ReturnType<typeof createOpsHandler>) => Promise<T>,
  options: { readonly commerceEnabled?: boolean; readonly markerWritesAllowed?: boolean; readonly platformMigration?: { request: (operation: "cutover") => Promise<unknown> } } = {},
): Promise<T> {
  return runInDurableObject(opsStub(), async (_instance, ctx) => {
    const dependencies: OpsRouteDependencies = {
      demoEnabled: false,
      // ADR 0104 decision 5: commerce defaults to ON here so the existing cases keep their ON meaning; OFF cases pass false.
      commerceEnabled: options.commerceEnabled ?? true,
      ...(options.platformMigration ? { platformMigration: options.platformMigration as OpsRouteDependencies["platformMigration"] } : {}),
      database: new DurableObjectSqlDatabase(ctx.storage),
      sharedSecret: SECRET,
      verifier: { verify: async () => true },
      operatorRepository: { findById: () => null, findAll: () => [], create: () => { throw new Error("unused"); }, update: () => { throw new Error("unused"); } } as unknown as OpsRouteDependencies["operatorRepository"],
      unitRepository: { findAll: () => [], findById: () => null, save: () => { throw new Error("unused"); } } as unknown as OpsRouteDependencies["unitRepository"],
      grantStore: { canActForOperator: () => false },
      sessionAuthority: { provisionAccessToken: () => { throw new Error("unused"); }, revokeAll: () => {} },
      storageBookmarks: { bookmarkForTime: async () => "bookmark", restoreOnNextSession: () => {} },
      cutoverMarker: { read: async () => null, createIfAbsent: async (value: unknown) => { markerWrites.push(JSON.stringify(value)); if (options.markerWritesAllowed) return { completedAt: value }; throw new Error("marker write must not run"); } } as unknown as OpsRouteDependencies["cutoverMarker"],
      audit: { record: () => {}, entries: () => [] },
      clock: () => new Date("2026-10-18T00:00:00Z"),
      tenantId: TENANT,
      commerceMigration: commerceMigration as OpsRouteDependencies["commerceMigration"],
    };
    return run(createOpsHandler(dependencies));
  });
}

const get = (path: string) => new Request(`${ORIGIN}${path}`, { method: "GET", headers: AUTH });
const post = (path: string, body: unknown) => new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", ...AUTH }, body: JSON.stringify(body) });

test("issue 24 review 6: building the commerce client with no COMMERCE binding does not throw", () => {
  const withoutBinding = { ...(env as unknown as CloudflareEnv), COMMERCE: undefined } as unknown as CloudflareEnv;
  expect(() => commerceMigrationClient(withoutBinding, TENANT)).not.toThrow();
});

test("issue 24 review 6: a commerce call with no COMMERCE binding rejects only when it is made", async () => {
  const withoutBinding = { ...(env as unknown as CloudflareEnv), COMMERCE: undefined } as unknown as CloudflareEnv;
  await expect(commerceMigrationClient(withoutBinding, TENANT).request("status")).rejects.toThrow();
});

test("issue 24 review 6: the Shortlet status route answers 200 and reports commerce as unavailable when the commerce call fails", async () => {
  const response = await withShortletOps(failingCommerce, [], handler => handler.handle(get("/_ops/status")));
  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({ ok: true, commerce: { ok: false, code: "COMMERCE_UNAVAILABLE" } });
});

test("issue 24 review 6: the Shortlet verify route answers 200 and reports commerce as unavailable when the commerce call fails", async () => {
  const response = await withShortletOps(failingCommerce, [], handler => handler.handle(get("/_ops/import/verify")));
  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({ ok: true, commerce: { ok: false, code: "COMMERCE_UNAVAILABLE" } });
});

test("issue 24 review 6: the Shortlet export route for a Shortlet table answers without touching commerce", async () => {
  const response = await withShortletOps(failingCommerce, [], handler => handler.handle(get("/_ops/export?table=merchants")));
  expect(response?.status).not.toBe(503);
  expect(response?.status).not.toBe(500);
});

test("issue 24 review 6: a cutover whose commerce call fails is refused with COMMERCE_CUTOVER_UNAVAILABLE and records no Shortlet cutover", async () => {
  const markerWrites: string[] = [];
  const response = await withShortletOps(failingCommerce, markerWrites, handler => handler.handle(post("/_ops/cutover/complete", {})));
  expect(response?.status).toBe(503);
  expect(await response?.json()).toMatchObject({ ok: false, code: "COMMERCE_CUTOVER_UNAVAILABLE" });
  expect(markerWrites).toEqual([]);
});

/** Records each commerce operation, and answers the zero-row check with the given count (ADR 0101 amendment, 25 Oct 2026). */
function recordingCommerce(calls: string[], rowCount: number) {
  return {
    request: async (operation: "status" | "verify" | "cutover" | "rows") => {
      calls.push(operation);
      return operation === "rows" ? { ok: true, rowCount } : { ok: true, cutoverCompletedAt: "2026-10-25T00:00:00.000Z" };
    },
  };
}
const platformRecorder = (calls: string[]) => ({
  request: async (operation: "cutover") => {
    calls.push(`platform:${operation}`);
    return { cutoverCompletedAt: "2026-10-25T00:00:00.000Z" };
  },
});

test("ADR 0101 amendment (25 Oct 2026): with commerce off and zero commerce rows, cutover skips the commerce object after the zero-row check", async () => {
  const calls: string[] = [];
  const markerWrites: string[] = [];
  const response = await withShortletOps(recordingCommerce(calls, 0), markerWrites, handler => handler.handle(post("/_ops/cutover/complete", {})), { commerceEnabled: false, markerWritesAllowed: true, platformMigration: platformRecorder(calls) });
  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({ ok: true, commerceCutoverCompletedAt: null });
  // The zero-row check runs first, so a later refusal would leave the platform and Shortlet cutovers unrecorded.
  expect(calls).toEqual(["rows", "platform:cutover"]);
  expect(markerWrites).toHaveLength(1);
});

test("ADR 0101 amendment (25 Oct 2026): with commerce off and commerce rows present, cutover is refused with COMMERCE_ROWS_PRESENT_WHILE_DISABLED and changes nothing", async () => {
  const calls: string[] = [];
  const markerWrites: string[] = [];
  const response = await withShortletOps(recordingCommerce(calls, 2), markerWrites, handler => handler.handle(post("/_ops/cutover/complete", {})), { commerceEnabled: false, markerWritesAllowed: true, platformMigration: platformRecorder(calls) });
  expect(response?.status).toBe(409);
  expect(await response?.json()).toMatchObject({ ok: false, code: "COMMERCE_ROWS_PRESENT_WHILE_DISABLED" });
  expect(calls).toEqual(["rows"]);
  expect(markerWrites).toEqual([]);
});

test("ADR 0101 amendment (25 Oct 2026): with commerce off and a failing zero-row check, cutover is refused with COMMERCE_CUTOVER_UNAVAILABLE and records nothing", async () => {
  const markerWrites: string[] = [];
  const calls: string[] = [];
  const response = await withShortletOps(failingCommerce, markerWrites, handler => handler.handle(post("/_ops/cutover/complete", {})), { commerceEnabled: false, platformMigration: platformRecorder(calls) });
  expect(response?.status).toBe(503);
  expect(await response?.json()).toMatchObject({ ok: false, code: "COMMERCE_CUTOVER_UNAVAILABLE" });
  expect(calls).toEqual([]);
  expect(markerWrites).toEqual([]);
});

test("ADR 0104 decision 5: with commerce on, cutover records the platform, then the commerce object, and does not run the zero-row check", async () => {
  const calls: string[] = [];
  const markerWrites: string[] = [];
  const response = await withShortletOps(recordingCommerce(calls, 5), markerWrites, handler => handler.handle(post("/_ops/cutover/complete", {})), { commerceEnabled: true, markerWritesAllowed: true, platformMigration: platformRecorder(calls) });
  expect(response?.status).toBe(200);
  expect(calls).toEqual(["platform:cutover", "cutover"]);
});
