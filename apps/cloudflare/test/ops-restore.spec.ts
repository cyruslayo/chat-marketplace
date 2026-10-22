import { SELF, runInDurableObject } from "cloudflare:test";
import { expect, test } from "vitest";
import type { UnitRepositoryContract } from "../../../domains/shortlet/src/browse.js";
import type { OperatorRepository } from "../../../domains/shortlet/src/operator.js";
import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import { createOpsHandler, type OpsRouteDependencies } from "../src/ops-routes.js";
import { ORIGIN, SECRET, TENANT, accessToken, opsHeaders, opsStub } from "./ops-test-helpers.js";

const UNUSED = (): never => { throw new Error("not used by the restore route"); };

/** A handler whose bookmark authority is a stub: workerd's local storage has no point-in-time recovery (see below). */
function restoreHandler(options: { readonly access: boolean; readonly bookmark: string }): ReturnType<typeof createOpsHandler> {
  const dependencies: OpsRouteDependencies = {
    demoEnabled: false,
    database: { prepare: UNUSED, exec: UNUSED, transaction: UNUSED, close: () => {} } as unknown as SqlDatabase,
    sharedSecret: SECRET,
    verifier: { verify: async () => options.access },
    operatorRepository: { findById: () => null, findAll: () => [], create: UNUSED, update: UNUSED } as unknown as OperatorRepository,
    unitRepository: { findAll: () => [], findById: () => null, save: UNUSED } as unknown as UnitRepositoryContract,
    grantStore: { canActForOperator: () => false },
    sessionAuthority: { provisionAccessToken: UNUSED, revokeAll: () => {} },
    storageBookmarks: { bookmarkForTime: async () => options.bookmark, restoreOnNextSession: () => {} },
    cutoverMarker: { read: async () => null, createIfAbsent: UNUSED },
    audit: { record: () => {}, entries: () => [] },
    clock: () => new Date(),
    tenantId: TENANT,
  };
  return createOpsHandler(dependencies);
}

function restoreRequest(headers: Record<string, string>, body: unknown): Request {
  return new Request(`${ORIGIN}/_ops/restore`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

test("12b AC2: the restore route needs both authentication layers, and a confirm without a dry-run bookmark is refused", async () => {
  const handler = restoreHandler({ access: true, bookmark: "bookmark-123" });

  // Missing both layers.
  const noAuth = await handler.handle(restoreRequest({}, {}));
  expect(noAuth?.status).toBe(401);
  // The Access layer refuses.
  const noAccess = await handler.handle(new Request(`${ORIGIN}/_ops/restore`, { method: "POST", headers: { "content-type": "application/json", "x-shortlet-ops-secret": SECRET }, body: "{}" }));
  expect(noAccess?.status).toBe(401);
  // The shared secret refuses (constant-time compare).
  const noSecret = await handler.handle(new Request(`${ORIGIN}/_ops/restore`, { method: "POST", headers: { "content-type": "application/json", "cf-access-jwt-assertion": "anything" }, body: "{}" }));
  expect(noSecret?.status).toBe(401);

  // Dry run: returns the bookmark, no restart needed yet.
  const dryRun = await handler.handle(restoreRequest({ "cf-access-jwt-assertion": "anything", "x-shortlet-ops-secret": SECRET }, {}));
  expect(dryRun?.status).toBe(200);
  expect(dryRun?.headers.get("cache-control")).toBe("no-store");
  const bookmark = (await dryRun!.json()).bookmark;
  expect(bookmark).toBe("bookmark-123");

  // A confirm that does not carry the dry-run bookmark is refused.
  const confirmWithout = await handler.handle(restoreRequest({ "cf-access-jwt-assertion": "anything", "x-shortlet-ops-secret": SECRET }, { confirm: true }));
  expect(confirmWithout?.status).toBe(400);

  // The explicit confirm schedules the restore on the next session.
  const confirm = await handler.handle(restoreRequest({ "cf-access-jwt-assertion": "anything", "x-shortlet-ops-secret": SECRET }, { confirm: true, bookmark }));
  expect(confirm?.status).toBe(200);
  expect(await confirm!.json()).toEqual({ ok: true, scheduled: true, restartRequired: true });
});

test("12b AC2: the deployed route refuses an unauthenticated request and a confirm without a bookmark", async () => {
  const response = await SELF.fetch(`${ORIGIN}/_ops/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(response.status).toBe(401);

  const confirmWithoutBookmark = await SELF.fetch(`${ORIGIN}/_ops/restore`, {
    method: "POST",
    headers: opsHeaders(await accessToken()),
    body: JSON.stringify({ confirm: true }),
  });
  expect(confirmWithoutBookmark.status).toBe(400);
});

/**
 * 12b AC3 — NOT verifiable here. workerd's Durable Object storage back-end (the Vitest pool) does not implement
 * point-in-time recovery: `ctx.storage.getBookmarkForTime` throws "This Durable Object's storage back-end does not
 * implement point-in-time recovery". The bookmark round trip is therefore documented in the runbook and must be
 * rehearsed on staging (slice 15), where the real storage back-end provides it.
 */
test("12b AC3: the local workerd storage back-end does not implement point-in-time recovery", async () => {
  const message = await runInDurableObject(opsStub(), async (_instance, ctx) => {
    try {
      await ctx.storage.getBookmarkForTime(Date.now());
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(message).toMatch(/does not implement point-in-time recovery/);
});
