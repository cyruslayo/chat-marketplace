import type { DatabaseSync } from "node:sqlite";
import type { PlatformCommandEnvelope } from "../../../packages/platform-core/src/index.js";

/**
 * Maximum Saved Stays per owner. Source: `.scratch/guest-stays-and-favourites/issues/01`, answer 6
 * (settled 3 Oct 2026). Overridable through `SavedStayManager` options.
 */
export const SAVED_STAY_LIMIT = 100;

/**
 * A Unit a Guest has saved to revisit. The owner is a Guest Account id, or a session principal before
 * sign-in. Only the unit and the time are kept: price and availability are always read live.
 */
export interface SavedStay {
  readonly ownerId: string;
  readonly tenantId: string;
  readonly unitId: string;
  readonly savedAt: string;
}

export interface SavedStayCommandInput {
  readonly unitId: string;
}

export interface SavedStayMoveResult {
  /** Units added to the new owner, newest first. */
  readonly moved: readonly string[];
  /** Units the new owner had already saved. */
  readonly alreadySaved: readonly string[];
  /** Units not added because the new owner's list was full (newest first); they are not kept. */
  readonly skipped: readonly string[];
}

export interface SavedStayStore {
  /** Newest first. */
  list(ownerId: string, tenantId: string): SavedStay[];
  has(ownerId: string, tenantId: string, unitId: string): boolean;
  count(ownerId: string, tenantId: string): number;
  insert(stay: SavedStay): void;
  remove(ownerId: string, tenantId: string, unitId: string): boolean;
  /** Runs `work` atomically; a thrown error leaves the store unchanged. */
  transaction<T>(work: () => T): T;
}

interface SavedStayAuditSink {
  record(entry: Record<string, string | number>): void;
}

function byNewest(a: SavedStay, b: SavedStay): number {
  return b.savedAt.localeCompare(a.savedAt) || a.unitId.localeCompare(b.unitId);
}

export class InMemorySavedStayStore implements SavedStayStore {
  #stays: SavedStay[] = [];
  list(ownerId: string, tenantId: string): SavedStay[] {
    return this.#stays.filter((stay) => stay.ownerId === ownerId && stay.tenantId === tenantId).sort(byNewest);
  }
  has(ownerId: string, tenantId: string, unitId: string): boolean {
    return this.#stays.some((stay) => stay.ownerId === ownerId && stay.tenantId === tenantId && stay.unitId === unitId);
  }
  count(ownerId: string, tenantId: string): number {
    return this.list(ownerId, tenantId).length;
  }
  insert(stay: SavedStay): void {
    if (this.has(stay.ownerId, stay.tenantId, stay.unitId)) throw new Error("Saved Stay already exists");
    this.#stays.push(Object.freeze({ ...stay }));
  }
  remove(ownerId: string, tenantId: string, unitId: string): boolean {
    const before = this.#stays.length;
    this.#stays = this.#stays.filter((stay) => !(stay.ownerId === ownerId && stay.tenantId === tenantId && stay.unitId === unitId));
    return this.#stays.length !== before;
  }
  transaction<T>(work: () => T): T {
    const snapshot = [...this.#stays];
    try {
      return work();
    } catch (error) {
      this.#stays = snapshot;
      throw error;
    }
  }
}

/** Unit-row guard for loosely typed SQLite rows (no `any` in the domain layer). */
interface SavedStayRow {
  owner_id: string;
  tenant_id: string;
  unit_id: string;
  saved_at: string;
}

export class SqliteSavedStayStore implements SavedStayStore {
  readonly #database: DatabaseSync;
  constructor(database: DatabaseSync) {
    this.#database = database;
    database.exec(`CREATE TABLE IF NOT EXISTS saved_stays (
      owner_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, tenant_id, unit_id)
    )`);
  }
  list(ownerId: string, tenantId: string): SavedStay[] {
    const rows = this.#database.prepare("SELECT * FROM saved_stays WHERE owner_id = $owner AND tenant_id = $tenant ORDER BY saved_at DESC, unit_id ASC").all({ $owner: ownerId, $tenant: tenantId }) as unknown as SavedStayRow[];
    return rows.map((row) => Object.freeze({ ownerId: row.owner_id, tenantId: row.tenant_id, unitId: row.unit_id, savedAt: row.saved_at }));
  }
  has(ownerId: string, tenantId: string, unitId: string): boolean {
    return this.#database.prepare("SELECT 1 FROM saved_stays WHERE owner_id = $owner AND tenant_id = $tenant AND unit_id = $unit").get({ $owner: ownerId, $tenant: tenantId, $unit: unitId }) !== undefined;
  }
  count(ownerId: string, tenantId: string): number {
    const row = this.#database.prepare("SELECT COUNT(*) AS total FROM saved_stays WHERE owner_id = $owner AND tenant_id = $tenant").get({ $owner: ownerId, $tenant: tenantId }) as { total: number } | undefined;
    return row?.total ?? 0;
  }
  insert(stay: SavedStay): void {
    this.#database.prepare("INSERT INTO saved_stays (owner_id, tenant_id, unit_id, saved_at) VALUES ($owner, $tenant, $unit, $at)").run({ $owner: stay.ownerId, $tenant: stay.tenantId, $unit: stay.unitId, $at: stay.savedAt });
  }
  remove(ownerId: string, tenantId: string, unitId: string): boolean {
    return this.#database.prepare("DELETE FROM saved_stays WHERE owner_id = $owner AND tenant_id = $tenant AND unit_id = $unit").run({ $owner: ownerId, $tenant: tenantId, $unit: unitId }).changes === 1;
  }
  transaction<T>(work: () => T): T {
    if (this.#database.isTransaction) return work();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const value = work();
      this.#database.exec("COMMIT");
      return value;
    } catch (error) {
      try { this.#database.exec("ROLLBACK"); } catch { /* preserve the original failure */ }
      throw error;
    }
  }
}

function required(value: string | undefined, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  return value;
}

/**
 * Saved Stays (guest-stays-and-favourites issue 11). Saving and removing are platform commands
 * (ADR 0072); the owner and tenant come from the command principal and fail closed when missing.
 */
export class SavedStayManager {
  readonly #store: SavedStayStore;
  readonly #clock: () => Date;
  readonly #maxSavedStays: number;
  readonly #audit?: SavedStayAuditSink;

  constructor(options: { store: SavedStayStore; clock?: () => Date; maxSavedStays?: number; audit?: SavedStayAuditSink }) {
    this.#store = options.store;
    this.#clock = options.clock ?? (() => new Date());
    this.#maxSavedStays = options.maxSavedStays ?? SAVED_STAY_LIMIT;
    if (!Number.isInteger(this.#maxSavedStays) || this.#maxSavedStays < 1) throw new Error("maxSavedStays must be a positive whole number");
    this.#audit = options.audit;
  }

  saveStay(envelope: PlatformCommandEnvelope<SavedStayCommandInput>): { outcome: "saved" | "already_saved"; savedStay: SavedStay } {
    const { ownerId, tenantId, unitId } = this.#command(envelope, "favourite.save");
    return this.#store.transaction(() => {
      const existing = this.#store.list(ownerId, tenantId).find((stay) => stay.unitId === unitId);
      if (existing) return { outcome: "already_saved" as const, savedStay: existing };
      if (this.#store.count(ownerId, tenantId) >= this.#maxSavedStays) throw new Error("SAVED_STAY_LIMIT_REACHED");
      const savedStay: SavedStay = Object.freeze({ ownerId, tenantId, unitId, savedAt: this.#now().toISOString() });
      this.#store.insert(savedStay);
      this.#emit({ type: "favourite.saved", ownerId, tenantId, unitId, commandId: envelope.commandId });
      return { outcome: "saved" as const, savedStay };
    });
  }

  removeStay(envelope: PlatformCommandEnvelope<SavedStayCommandInput>): { removed: boolean } {
    const { ownerId, tenantId, unitId } = this.#command(envelope, "favourite.remove");
    const removed = this.#store.remove(ownerId, tenantId, unitId);
    if (removed) this.#emit({ type: "favourite.removed", ownerId, tenantId, unitId, commandId: envelope.commandId });
    return { removed };
  }

  listSavedStays(ownerId: string, tenantId: string): SavedStay[] {
    return this.#store.list(required(ownerId, "Owner"), required(tenantId, "Saved Stay tenant"));
  }

  /**
   * Moves a session principal's saves to a Guest Account on sign-in. Account saves are never dropped;
   * device saves are added newest first up to the cap, and the rest are reported as skipped and not
   * kept (issue 11, merge over the cap). The source owner ends with no saves.
   */
  moveSavesToOwner(input: { fromOwnerId: string; toOwnerId: string; tenantId: string }): SavedStayMoveResult {
    const fromOwnerId = required(input.fromOwnerId, "Source owner");
    const toOwnerId = required(input.toOwnerId, "Target owner");
    const tenantId = required(input.tenantId, "Saved Stay tenant");
    if (fromOwnerId === toOwnerId) return { moved: [], alreadySaved: [], skipped: [] };
    const result = this.#store.transaction(() => {
      const moved: string[] = [], alreadySaved: string[] = [], skipped: string[] = [];
      let count = this.#store.count(toOwnerId, tenantId);
      for (const stay of this.#store.list(fromOwnerId, tenantId)) {
        this.#store.remove(fromOwnerId, tenantId, stay.unitId);
        if (this.#store.has(toOwnerId, tenantId, stay.unitId)) alreadySaved.push(stay.unitId);
        else if (count >= this.#maxSavedStays) skipped.push(stay.unitId);
        else {
          this.#store.insert({ ...stay, ownerId: toOwnerId });
          moved.push(stay.unitId);
          count += 1;
        }
      }
      return { moved, alreadySaved, skipped };
    });
    this.#emit({ type: "favourite.moved", fromOwnerId, toOwnerId, tenantId, moved: result.moved.length, alreadySaved: result.alreadySaved.length, skipped: result.skipped.length });
    return result;
  }

  #command(envelope: PlatformCommandEnvelope<SavedStayCommandInput>, commandName: "favourite.save" | "favourite.remove"): { ownerId: string; tenantId: string; unitId: string } {
    if (!envelope || envelope.commandName !== commandName) throw new Error(`Invalid envelope: commandName must be '${commandName}'`);
    if (!envelope.principal || envelope.principal.role !== "guest") throw new Error("Only a Guest may change Saved Stays");
    const ownerId = required(envelope.principal.id, "Guest");
    const tenantId = required(envelope.principal.tenantId, "Saved Stay tenant");
    const unitId = required(envelope.payload?.unitId, "Unit");
    return { ownerId, tenantId, unitId: unitId.trim() };
  }

  #now(): Date {
    const now = this.#clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Server clock is invalid");
    return now;
  }

  #emit(entry: Record<string, string | number>): void {
    try { this.#audit?.record({ ...entry, recordedAt: this.#now().toISOString() }); } catch { /* audit must not block the Guest */ }
  }
}
