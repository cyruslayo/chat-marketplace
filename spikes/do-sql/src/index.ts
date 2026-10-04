import { DurableObject } from "cloudflare:workers";

export class SqlProbe extends DurableObject {
  fetch(request: Request): Response {
    const probe = new URL(request.url).pathname.slice(1);
    const sql = this.ctx.storage.sql;
    try {
      switch (probe) {
        case "parameters": {
          const results: Record<string, unknown> = {};
          for (const [name, query, value] of [
            ["plain", "SELECT ? AS value", "plain"],
            ["numbered", "SELECT ?1 AS value", "numbered"],
            ["named", "SELECT $value AS value", "named"],
          ] as const) {
            try { results[name] = sql.exec(query, value).toArray(); }
            catch (error) { results[name] = error instanceof Error ? error.message : String(error); }
          }
          return Response.json(results);
        }
        case "multistatement": {
          sql.exec("CREATE TABLE IF NOT EXISTS probe_multi (id INTEGER PRIMARY KEY); CREATE INDEX IF NOT EXISTS probe_multi_idx ON probe_multi(id);");
          return Response.json(sql.exec("SELECT name FROM sqlite_master WHERE name IN ('probe_multi', 'probe_multi_idx') ORDER BY name").toArray());
        }
        case "pragmas": {
          const results: Record<string, unknown> = {};
          for (const [name, query] of [
            ["busy_timeout", "PRAGMA busy_timeout = 5000"],
            ["foreign_keys", "PRAGMA foreign_keys = ON"],
            ["table_info", "PRAGMA table_info('probe_multi')"],
            ["journal_mode", "PRAGMA journal_mode"],
          ] as const) {
            try { results[name] = sql.exec(query).toArray(); }
            catch (error) { results[name] = error instanceof Error ? error.message : String(error); }
          }
          sql.exec("CREATE TABLE IF NOT EXISTS probe_parent (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS probe_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES probe_parent(id));");
          try { sql.exec("INSERT INTO probe_child (id, parent_id) VALUES (?, ?)", 1, 999); results.foreignKeyEnforced = false; }
          catch (error) { results.foreignKeyEnforced = true; results.foreignKeyError = error instanceof Error ? error.message : String(error); }
          return Response.json(results);
        }
        case "foreign-key-default": {
          const results: Record<string, unknown> = { foreignKeys: sql.exec("PRAGMA foreign_keys").toArray() };
          sql.exec("CREATE TABLE IF NOT EXISTS probe_default_parent (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS probe_default_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES probe_default_parent(id));");
          try { sql.exec("INSERT INTO probe_default_child (id, parent_id) VALUES (?, ?)", 1, 999); results.enforced = false; }
          catch (error) { results.enforced = true; results.error = error instanceof Error ? error.message : String(error); }
          return Response.json(results);
        }
        case "blob": {
          sql.exec("CREATE TABLE IF NOT EXISTS probe_blob (kind TEXT PRIMARY KEY, value BLOB)");
          const bytes = new Uint8Array([0, 1, 127, 255]);
          const variants: Record<string, unknown> = {};
          for (const [kind, value] of [["uint8", bytes], ["arraybuffer", bytes.buffer.slice(0)] as const]) {
            try {
              sql.exec("INSERT OR REPLACE INTO probe_blob (kind, value) VALUES (?, ?)", kind, value);
              const result = sql.exec("SELECT value FROM probe_blob WHERE kind = ?", kind).toArray()[0]?.value;
              variants[kind] = { outputType: result?.constructor?.name ?? typeof result, bytes: result ? Array.from(new Uint8Array(result as ArrayBuffer)) : null };
            } catch (error) { variants[kind] = error instanceof Error ? error.message : String(error); }
          }
          return Response.json(variants);
        }
        case "transactions": {
          sql.exec("CREATE TABLE IF NOT EXISTS probe_tx (id INTEGER PRIMARY KEY, value TEXT)");
          const results: Record<string, unknown> = {};
          try {
            this.ctx.storage.transactionSync(() => {
              sql.exec("INSERT INTO probe_tx (id, value) VALUES (?, ?)", 1, "outer");
              this.ctx.storage.transactionSync(() => sql.exec("INSERT INTO probe_tx (id, value) VALUES (?, ?)", 2, "inner"));
            });
            results.nestedSuccess = "committed";
          } catch (error) { results.nestedSuccess = error instanceof Error ? error.message : String(error); }
          results.rowsAfterNested = sql.exec("SELECT id, value FROM probe_tx ORDER BY id").toArray();
          try {
            this.ctx.storage.transactionSync(() => {
              sql.exec("INSERT INTO probe_tx (id, value) VALUES (?, ?)", 3, "outer-fail");
              this.ctx.storage.transactionSync(() => sql.exec("INSERT INTO probe_tx (id, value) VALUES (?, ?)", 4, "inner-fail"));
              throw new Error("outer rollback sentinel");
            });
          } catch (error) { results.rollbackError = error instanceof Error ? error.message : String(error); }
          results.rowsAfterRollback = sql.exec("SELECT id FROM probe_tx ORDER BY id").toArray();
          try { this.ctx.storage.transactionSync(() => { sql.exec("INSERT INTO probe_tx (id, value) VALUES (?, ?)", 5, "promise"); return Promise.resolve(); }); results.promiseReturn = "accepted"; }
          catch (error) { results.promiseReturn = error instanceof Error ? error.message : String(error); }
          results.rowsAfterPromise = sql.exec("SELECT id FROM probe_tx ORDER BY id").toArray();
          return Response.json(results);
        }
        case "nested-throw": {
          sql.exec("CREATE TABLE IF NOT EXISTS probe_nested_throw (id INTEGER PRIMARY KEY, value TEXT)");
          const results: Record<string, unknown> = {};
          try {
            this.ctx.storage.transactionSync(() => {
              sql.exec("INSERT INTO probe_nested_throw (id, value) VALUES (?, ?)", 1, "outer-catches-inner");
              try {
                this.ctx.storage.transactionSync(() => { sql.exec("INSERT INTO probe_nested_throw (id, value) VALUES (?, ?)", 2, "inner-throws"); throw new Error("inner rollback sentinel"); });
              } catch (error) { results.nestedThrow = error instanceof Error ? error.message : String(error); }
              sql.exec("INSERT INTO probe_nested_throw (id, value) VALUES (?, ?)", 3, "outer-after-inner-throw");
            });
            results.outerAfterCaughtNestedThrow = "committed";
          } catch (error) { results.outerAfterCaughtNestedThrow = error instanceof Error ? error.message : String(error); }
          results.rows = sql.exec("SELECT id, value FROM probe_nested_throw ORDER BY id").toArray();
          return Response.json(results);
        }
        case "rows-written": {
          sql.exec("CREATE TABLE IF NOT EXISTS probe_count (id INTEGER PRIMARY KEY, value INTEGER); CREATE TABLE IF NOT EXISTS probe_trigger (id INTEGER PRIMARY KEY, value INTEGER); CREATE TRIGGER IF NOT EXISTS probe_count_trigger AFTER UPDATE ON probe_count BEGIN INSERT INTO probe_trigger(value) VALUES (new.value); END;");
          sql.exec("INSERT OR IGNORE INTO probe_count (id, value) VALUES (?, ?)", 1, 1);
          const ignored = sql.exec("INSERT OR IGNORE INTO probe_count (id, value) VALUES (?, ?)", 1, 2);
          const ignoredChanges = sql.exec("SELECT changes() AS changes").toArray();
          const update = sql.exec("UPDATE probe_count SET value = ? WHERE id = ?", 2, 1);
          const updateChanges = sql.exec("SELECT changes() AS changes").toArray();
          const unmatched = sql.exec("UPDATE probe_count SET value = ? WHERE id = ?", 3, 999);
          const unmatchedChanges = sql.exec("SELECT changes() AS changes").toArray();
          return Response.json({ ignored: ignored.rowsWritten, ignoredChanges, update: update.rowsWritten, updateChanges, unmatched: unmatched.rowsWritten, unmatchedChanges, triggerRows: sql.exec("SELECT COUNT(*) AS count FROM probe_trigger").toArray() });
        }
        case "limits": {
          sql.exec("CREATE TABLE IF NOT EXISTS probe_limit (value TEXT)");
          const parameterValues = Array.from({ length: 100 }, () => 1);
          const parameterNames = Array.from({ length: 100 }, (_, i) => `?${i + 1}`).join(",");
          const results: Record<string, unknown> = {};
          for (const [name, count] of [["100", 100], ["101", 101]] as const) {
            const placeholders = Array.from({ length: count }, () => "?").join(",");
            try { results[`parameters${name}`] = sql.exec(`SELECT ${placeholders}`, ...Array.from({ length: count }, () => 1)).toArray()[0] ? "accepted" : "no-row"; }
            catch (error) { results[`parameters${name}`] = error instanceof Error ? error.message : String(error); }
          }
          void parameterValues; void parameterNames;
          for (const [name, size] of [["2MiB", 2 * 1024 * 1024], ["2MiBPlusOne", 2 * 1024 * 1024 + 1]] as const) {
            try { sql.exec("INSERT INTO probe_limit (value) VALUES (?)", "x".repeat(size)); results[name] = "accepted"; }
            catch (error) { results[name] = error instanceof Error ? error.message : String(error); }
          }
          return Response.json(results);
        }
        default: return new Response("unknown probe", { status: 404 });
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const objectName = url.searchParams.get("object") ?? "sql-spike";
    const stub = env.SHORTLET.get(env.SHORTLET.idFromName(objectName));
    return stub.fetch(new Request(new URL(`${url.pathname.slice(1)}${url.search}`, request.url)));
  },
} satisfies ExportedHandler<Env>;
