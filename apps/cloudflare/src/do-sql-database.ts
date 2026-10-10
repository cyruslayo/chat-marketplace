import type { DurableObjectStorage } from "@cloudflare/workers-types";
import type { SqlDatabase, SqlParams, SqlRow, SqlStatement, SqlValue } from "../../../packages/platform-core/src/sql-database.js";
import { MAX_STATEMENT_PARAMETERS } from "../../../packages/platform-core/src/data-migration.js";

// The parameter limit is the one in data-migration.ts (Cloudflare DO limits page; verify before cutover). SQL platform limit, not booking policy.
const MAX_SQL_PARAMETERS = MAX_STATEMENT_PARAMETERS;
const MAX_SQL_VALUE_BYTES = 2 * 1024 * 1024;

// Quoted strings/identifiers and comments are opaque, including escaped quotes.
const SQL_TOKENS = /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:[^\]])*\]|--[^\r\n]*|\/\*[\s\S]*?\*\/|\$[A-Za-z_][A-Za-z_0-9]*/g;
interface Translation { sql: string; names: string[] }

function translate(sql: string): Translation {
  const names: string[] = [];
  return {
    sql: sql.replace(SQL_TOKENS, (token) => {
      if (!token.startsWith("$")) return token;
      let index = names.indexOf(token);
      if (index === -1) { index = names.length; names.push(token); }
      return `?${index + 1}`;
    }),
    names,
  };
}

function bindings(params: SqlParams | undefined, names: readonly string[]): (string | number | null | ArrayBuffer)[] {
  const values: readonly SqlValue[] = Array.isArray(params)
    ? params
    : names.map((name) => {
        if (!params || !Object.hasOwn(params, name)) throw new TypeError(`Unbound SQL parameter ${name}`);
        return (params as Record<string, SqlValue>)[name]!;
      });
  if (values.length > MAX_SQL_PARAMETERS) throw new RangeError("SQL statement exceeds 100 bound parameters");
  return values.map((value) => {
    if (value === undefined) throw new TypeError("SQL parameters must not be undefined");
    if (typeof value === "string" && new TextEncoder().encode(value).byteLength > MAX_SQL_VALUE_BYTES || value instanceof Uint8Array && value.byteLength > MAX_SQL_VALUE_BYTES)
      throw new RangeError("SQL value exceeds 2 MiB");
    if (value instanceof Uint8Array) return Uint8Array.from(value).buffer;
    if (typeof value === "bigint") {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new RangeError("Durable Object SQL cannot bind bigint outside the safe integer range");
      return number;
    }
    return value;
  });
}

function row(record: Record<string, unknown>): SqlRow {
  const result: SqlRow = {};
  for (const [key, value] of Object.entries(record)) {
    if (value instanceof ArrayBuffer) result[key] = new Uint8Array(value);
    else if (value === null || typeof value === "string" || typeof value === "number" || value instanceof Uint8Array) result[key] = value;
    else throw new TypeError("Durable Object SQL returned an unsupported cell type");
  }
  return result;
}

export class DurableObjectSqlDatabase implements SqlDatabase {
  readonly #translations = new Map<string, Translation>();
  constructor(private readonly storage: DurableObjectStorage) {}

  prepare(sql: string): SqlStatement {
    let translation = this.#translations.get(sql);
    if (!translation) { translation = translate(sql); this.#translations.set(sql, translation); }
    const { sql: translated, names } = translation;
    const execute = (params?: SqlParams) => this.storage.sql.exec(translated, ...bindings(params, names));
    return {
      get: (params) => { const first = execute(params).next(); return first.done ? undefined : row(first.value); },
      all: (params) => execute(params).toArray().map(row),
      run: (params) => {
        execute(params).toArray();
        // 01a: rowsWritten includes triggers; changes() matches the Node port's direct changes.
        const changes = this.storage.sql.exec<{ changes: number }>("SELECT changes() AS changes").one().changes;
        return { changes };
      },
    };
  }

  exec(sql: string): void {
    // 01a: ignore ONLY these compatibility PRAGMAs; literals/comments remain untouched.
    const compatible = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:[^\]])*\]|--[^\r\n]*|\/\*[\s\S]*?\*\/|\bPRAGMA\s+(?:busy_timeout|journal_mode)\b[^;]*(?:;|$)/gi, (token) => /^PRAGMA\s/i.test(token) ? "" : token);
    if (compatible.trim()) this.storage.sql.exec(compatible).toArray();
  }

  transaction<T>(fn: () => T): T {
    // ADR 0095: nested transactionSync provides the same rollback boundaries as Node savepoints.
    return this.storage.transactionSync(() => {
      const result = fn();
      if (((typeof result === "object" && result !== null) || typeof result === "function") && "then" in result && typeof result.then === "function")
        throw new TypeError("SQL transaction callbacks must be synchronous");
      return result;
    });
  }

  close(): void { /* Durable Object owns storage. */ }
}
