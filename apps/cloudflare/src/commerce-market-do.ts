import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "@cloudflare/workers-types";
import { createCommercePack, parseCreateOrderInput, type CreateOrderInput } from "../../../domains/commerce/src/index.js";
import { assertMerchantOrdersShape, assertPaymentReferenceHashes, COMMERCE_MIGRATION_FAILED, CommerceSchemaShapeError, COMMERCE_SCHEMA_SHAPE_INVALID, INVALID_PAYMENT_REFERENCE_HASH } from "./commerce-schema-guard.js";
import { CommerceReferenceKeyError, COMMERCE_REFERENCE_KEY_INVALID, paymentReferenceKeysFromEnv } from "./commerce-reference-keys.js";
import { commerceAlarmPlan } from "./commerce-alarm.js";
import { applySchemaMigrations } from "../../../packages/platform-core/src/schema-migrations.js";
import { checksumTables, sha256OfBytes } from "../../../packages/platform-core/src/data-migration.js";
import { COMMERCE_DISABLED, COMMERCE_ENABLED_INVALID, commerceEnabledFromEnv, commerceRowCount, commerceTableExists } from "./commerce-switch.js";
import { schemaVersion } from "../../../packages/platform-core/src/schema-migrations.js";
import { DurableObjectSqlDatabase } from "./do-sql-database.js";
import { commerceMigrationsWithCutover } from "./commerce-migrations.js";
import type { CommerceObjectEnv } from "./commerce-env.js";
import { COMMERCE_EXPORT_TABLES, COMMERCE_OWNED_TABLES, lagosDate, runDailyExport, sweepExpiredExports } from "./do-export.js";
import { loadExportConfiguration } from "./export-config.js";
import { assertCutoverOpenForImport, assertSchemaCurrent, exportTable, importBatch } from "./ops-import-core.js";
import { completeCutoverWithMarker, cutoverStatus, createCutoverMarkerStore, reconcileCutover } from "./cutover-marker.js";

const DAILY_ALARM_MS = 24 * 60 * 60 * 1000;

/** The exact key sets each internal ops request may carry; `tenantId` is checked before any of these apply. */
const OPS_KEYS = {
  import: ["tenantId", "table", "rows"],
  export: ["tenantId", "table"],
  metadata: ["tenantId"],
  cutover: ["tenantId"],
} as const;

function hasExactKeys(input: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(input);
  return actual.length === keys.length && keys.every(key => actual.includes(key));
}

/** The fixed refusal for every commerce request while commerce is switched off (ADR 0104 decision 5). */
function disabledResponse(): Response {
  return Response.json({ ok: false, code: COMMERCE_DISABLED }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

/** Commerce transaction authority. It never shares SQL or a synchronous transaction with another DO (ADR 0099/0101). */
export class CommerceMarket extends DurableObject<CommerceObjectEnv> {
  #pack: ReturnType<typeof createCommercePack> | null = null;
  /** The expected schema version: the pack's migrations plus the cutover flag (set once, before any request is served). */
  #schemaVersion = 0;
  /** A fixed code when the schema could not be brought to the expected shape; the object then refuses every request. */
  #failure: string | null = null;
  /** ADR 0104 decision 5: whether commerce is on. Off means no pack, no key pair and no schema migration. */
  #enabled = false;
  constructor(ctx: DurableObjectState, env: CommerceObjectEnv) {
    super(ctx, env);
    let enabled: boolean;
    try {
      enabled = commerceEnabledFromEnv({ COMMERCE_ENABLED: env.COMMERCE_ENABLED });
    } catch {
      // An invalid switch value refuses every request. The error names the variable; only the fixed code is kept or logged.
      this.#failure = COMMERCE_ENABLED_INVALID;
      console.error(COMMERCE_ENABLED_INVALID);
      return;
    }
    this.#enabled = enabled;
    void ctx.blockConcurrencyWhile(async () => {
      if (!enabled) {
        // ADR 0104 decision 5: while off the object needs no key and runs no migration. It keeps its daily alarm for the export obligation.
        if (await ctx.storage.getAlarm() === null) await ctx.storage.setAlarm(Date.now() + DAILY_ALARM_MS);
        return;
      }
      const database = new DurableObjectSqlDatabase(ctx.storage);
      try {
        // The key is read here, before the pack is built; a missing or short key fails closed (user decision 18 Oct 2026).
        const pack = createCommercePack({ database, clock: () => new Date(), paymentReferenceKeys: paymentReferenceKeysFromEnv(env) });
        this.#pack = pack;
        const migrations = commerceMigrationsWithCutover(pack.migrations);
        this.#schemaVersion = migrations.length;
        applySchemaMigrations(database, migrations, new Date().toISOString());
        assertMerchantOrdersShape(database);
      } catch (error) {
        // Issue 24 reviews 2 and 5: fail closed. Every request is refused with the fixed code; the error and any row are never logged.
        this.#failure = error instanceof CommerceSchemaShapeError ? COMMERCE_SCHEMA_SHAPE_INVALID
          : error instanceof CommerceReferenceKeyError ? COMMERCE_REFERENCE_KEY_INVALID
          : COMMERCE_MIGRATION_FAILED;
        console.error(this.#failure);
        return;
      }
      try { await reconcileCutover(database, createCutoverMarkerStore(env.EXPORTS, ctx.id.toString(), "commerce")); } catch {
        // Import remains fail-closed if the marker cannot be reconciled. Only the fixed code is logged, never the error or references.
        console.error("COMMERCE_CUTOVER_RECONCILE_FAILED");
      }
      if (await ctx.storage.getAlarm() === null) await ctx.storage.setAlarm(Date.now() + DAILY_ALARM_MS);
    });
  }

  async alarm(): Promise<void> {
    // Final review F5 and the review of 8febb76: a failed object does not export, but it still sweeps its own expired exports.
    const today = lagosDate(new Date());
    const plan = commerceAlarmPlan({ failure: this.#failure, lastExportDate: (await this.ctx.storage.get<string>("commerce:export:lastDate")) ?? null, today });
    if (plan.logCode !== null) console.error(plan.logCode);
    // ADR 0104 decision 5 / ADR 0101 amendment: while off, the daily export runs only when every commerce table exists. Otherwise
    // there is nothing to export, and the object runs only its retention sweep.
    const database = new DurableObjectSqlDatabase(this.ctx.storage);
    const exportable = this.#enabled || COMMERCE_EXPORT_TABLES.every(table => commerceTableExists(database, table));
    if (plan.runExport && exportable) {
      const config = loadExportConfiguration(this.env);
      await runDailyExport({ database, exports: this.env.EXPORTS, clock: () => new Date(), ...config, tableOwner: "commerce" });
      await this.ctx.storage.put("commerce:export:lastDate", today);
    } else if (plan.runRetentionSweep || plan.runExport) {
      // The owner-scoped sweep needs only the bucket, the clock, the retention and the commerce tables: no export, no database, no pack.
      try {
        const config = loadExportConfiguration(this.env);
        await sweepExpiredExports({ exports: this.env.EXPORTS, clock: () => new Date(), retentionDays: config.retentionDays }, today, COMMERCE_EXPORT_TABLES);
      } catch {
        console.error("COMMERCE_RETENTION_SWEEP_FAILED");
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + DAILY_ALARM_MS);
  }

  async fetch(request: Request): Promise<Response> {
    if (this.#failure !== null) return Response.json({ ok: false, code: this.#failure }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const url = new URL(request.url);
    if (url.pathname.startsWith("/_internal/")) return this.#internal(request, url.pathname);
    // No public order route: checkout is reachable only through the internal client (ADR 0101, issue 24 decision).
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  #commerce(): ReturnType<typeof createCommercePack> {
    // Built once in the constructor, with its keys. A null pack means start-up failed, and fetch refuses before this runs.
    if (this.#pack === null) throw new Error("The commerce pack is not ready");
    return this.#pack;
  }

  /**
   * Internal checkout (issue 24 decision, ADR 0096): validates the store, offers, zone and server-computed total with the
   * domain rules, then stops with payment_unavailable. No order row is written and no stock is reserved, and the
   * payment reference is neither stored here nor returned.
   */
  #checkout(input: Record<string, unknown>): Response {
    let checkout: CreateOrderInput;
    try { checkout = parseCreateOrderInput(input); } catch { return Response.json({ ok: false, code: "BAD_REQUEST" }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
    try {
      this.#commerce().orders.quoteCheckout(checkout);
    } catch (error) {
      return Response.json({ ok: false, code: "ORDER_REJECTED", message: error instanceof Error ? error.message : "Order rejected" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ ok: false, code: "payment_unavailable" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  /**
   * ADR 0104 decision 5 and the ADR 0101 amendment (25 Oct 2026). While commerce is off the object serves only: an empty import
   * batch (a restore carrying no commerce rows), and the export of rows it already holds, which the export obligation (ADR 0096)
   * still covers. A non-empty import, a cutover, and every checkout are refused with COMMERCE_DISABLED.
   */
  async #switchedOff(operation: string, input: Record<string, unknown>, database: DurableObjectSqlDatabase): Promise<Response> {
    if (operation === "import" && typeof input.table === "string" && Array.isArray(input.rows) && hasExactKeys(input, OPS_KEYS.import)) {
      if (input.rows.length === 0 && COMMERCE_OWNED_TABLES.has(input.table)) return Response.json({ ok: true, table: input.table, received: 0, statements: 0, maxParameters: 0 });
      return disabledResponse();
    }
    if (operation === "export" && typeof input.table === "string" && hasExactKeys(input, OPS_KEYS.export) && COMMERCE_OWNED_TABLES.has(input.table)) {
      // A table that was never created holds no rows, so its export is the empty export of that table.
      if (!commerceTableExists(database, input.table)) return Response.json({ ok: true, table: input.table, rowCount: 0, sha256: await sha256OfBytes(new Uint8Array()), content: "" });
      return Response.json({ ok: true, ...(await exportTable(database, input.table)) });
    }
    if ((operation === "verify" || operation === "status") && hasExactKeys(input, OPS_KEYS.metadata)) {
      return Response.json({ ok: true, commerceEnabled: false, rowCount: commerceRowCount(database) });
    }
    return disabledResponse();
  }

  async #internal(request: Request, path: string): Promise<Response> {
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    let body: unknown;
    try { body = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return new Response("Bad request", { status: 400 });
    const input = body as Record<string, unknown>;
    const tenantId = this.env.SHORTLET_TENANT_ID?.trim() ?? "";
    if (!tenantId || input.tenantId !== tenantId) return Response.json({ ok: false, code: "INVALID_SCOPE" }, { status: 403 });
    // ADR 0104 decision 5: checkout is refused with the fixed code while commerce is off.
    if (path === "/_internal/checkout") return this.#enabled ? this.#checkout(input) : disabledResponse();
    if (!path.startsWith("/_internal/ops/")) return new Response("Not found", { status: 404 });
    const operation = path.slice("/_internal/ops/".length);
    const database = new DurableObjectSqlDatabase(this.ctx.storage);
    const marker = createCutoverMarkerStore(this.env.EXPORTS, this.ctx.id.toString(), "commerce");
    try {
      // The zero-row check is allowed in both states (ADR 0101 amendment, 25 Oct 2026): the Worker asks it before a cutover.
      if (operation === "rows" && hasExactKeys(input, OPS_KEYS.metadata)) return Response.json({ ok: true, rowCount: commerceRowCount(database) });
      if (!this.#enabled) return await this.#switchedOff(operation, input, database);
      if (operation === "import" && typeof input.table === "string" && Array.isArray(input.rows) && hasExactKeys(input, OPS_KEYS.import)) {
        // Issue 24 review 10: a restored order must carry a well-formed hash. The refusal names the code only, never the values.
        if (input.table === "merchant_orders") {
          try { assertPaymentReferenceHashes(input.rows as unknown[]); } catch {
            return Response.json({ ok: false, code: INVALID_PAYMENT_REFERENCE_HASH }, { status: 400, headers: { "Cache-Control": "no-store" } });
          }
        }
        assertSchemaCurrent(database, this.#schemaVersion);
        await assertCutoverOpenForImport(database, marker);
        return Response.json({ ok: true, ...importBatch(database, input.table, input.rows, this.#schemaVersion, new Date()) });
      }
      if (operation === "export" && typeof input.table === "string" && hasExactKeys(input, OPS_KEYS.export)) return Response.json({ ok: true, ...(await exportTable(database, input.table)) });
      if ((operation === "verify" || operation === "status") && hasExactKeys(input, OPS_KEYS.metadata)) {
        const cutover = await cutoverStatus(database, marker);
        return Response.json({ ok: true, schemaVersion: schemaVersion(database), expectedSchemaVersion: this.#schemaVersion,
          ...(operation === "verify" ? { tables: await checksumTables(database), excludedTables: {} } : {}),
          cutoverCompletedAt: cutover.completedAt, cutoverMarker: cutover.marker });
      }
      if (operation === "cutover" && hasExactKeys(input, OPS_KEYS.cutover)) {
        assertSchemaCurrent(database, this.#schemaVersion);
        return Response.json({ ok: true, cutoverCompletedAt: await completeCutoverWithMarker(database, marker, new Date().toISOString()) });
      }
      return new Response("Not found", { status: 404 });
    } catch {
      return Response.json({ ok: false, code: "COMMERCE_MIGRATION_OPERATION_FAILED" }, { status: 400 });
    }
  }
}
