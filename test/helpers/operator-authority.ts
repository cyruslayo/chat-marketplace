import { after } from "node:test";
import { openNodeSqliteDatabase, type NodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import { SqliteOperatorRepresentativeGrantStore } from "../../domains/shortlet/src/operator-representative-authority.js";
import { SqliteOperatorSessionAuthority } from "../../domains/shortlet/src/operator-session-authority.js";

const databases = new Set<NodeSqliteDatabase>();
after(() => { for (const database of databases) database.close(); databases.clear(); });

/** Path convenience belongs to tests; close() closes the test-owned handle, not a domain-owned connection. */
export function createTestOperatorGrantStore(path: string, options: ConstructorParameters<typeof SqliteOperatorRepresentativeGrantStore>[1] = {}): SqliteOperatorRepresentativeGrantStore {
  const database = openNodeSqliteDatabase(path);
  databases.add(database);
  return Object.assign(new SqliteOperatorRepresentativeGrantStore(database, options), { close: () => { if (databases.delete(database)) database.close(); } });
}

export function createTestOperatorSessionAuthority(path: string, options: ConstructorParameters<typeof SqliteOperatorSessionAuthority>[1] = {}): SqliteOperatorSessionAuthority {
  const database = openNodeSqliteDatabase(path);
  databases.add(database);
  return Object.assign(new SqliteOperatorSessionAuthority(database, options), { close: () => { if (databases.delete(database)) database.close(); } });
}
