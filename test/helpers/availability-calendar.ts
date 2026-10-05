import { after } from "node:test";
import { AvailabilityCalendar, type AvailabilityCalendarOptions } from "../../domains/shortlet/src/availability.js";
import { SqliteAvailabilityStore } from "../../domains/shortlet/src/availability-store.js";
import { openNodeSqliteDatabase, type NodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";

const databases: NodeSqliteDatabase[] = [];
after(() => {
  for (const database of databases.splice(0)) database.close();
});

/** Tests own their in-memory handles; domain calendars and stores only borrow them (ADR 0095). */
export function createTestAvailabilityCalendar(options: Omit<AvailabilityCalendarOptions, "store"> = {}): AvailabilityCalendar {
  const database = openNodeSqliteDatabase(":memory:");
  databases.push(database);
  return new AvailabilityCalendar({ ...options, store: new SqliteAvailabilityStore(database) });
}
