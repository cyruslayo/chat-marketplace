import type { SqlDatabase } from "./sql-database.js";

/** Existing pilot limits: 3,000 provider attempts per tenant-day and 60 per guest-session-hour. */
export const DEFAULT_MODEL_REQUEST_QUOTA_LIMITS = Object.freeze({
  tenantDaily: 3_000,
  guestHourly: 60,
});

export const MODEL_REQUEST_QUOTA_SCHEMA = `
CREATE TABLE IF NOT EXISTS model_request_tenant_daily (
  tenant_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  reservation_count INTEGER NOT NULL CHECK(reservation_count >= 0),
  PRIMARY KEY (tenant_id, day_key)
);
CREATE TABLE IF NOT EXISTS model_request_guest_reservations (
  reservation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  reserved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS model_request_guest_window_idx ON model_request_guest_reservations (tenant_id, guest_id, reserved_at);`;

export interface ModelRequestQuotaPort {
  reserve(input: { readonly tenantId: string; readonly guestId: string }): Promise<ModelRequestQuotaReservation>;
}

export type ModelRequestQuotaReservation =
  | { readonly reserved: true }
  | { readonly reserved: false; readonly reason: "tenant_day_limit" | "guest_hour_limit" };

export interface SqliteModelRequestQuotaOptions {
  readonly dailyTenantLimit?: number;
  readonly hourlyGuestLimit?: number;
  readonly clock?: () => Date;
}

/**
 * Durable quota authority for Node hosts. Limits and time come from this server-side instance.
 * ADR 0095 relies on synchronous transactions; ADR 0101 places shared Cloudflare authority in PLATFORM.
 */
export class SqliteModelRequestQuota implements ModelRequestQuotaPort {
  readonly #database: SqlDatabase;
  readonly #dailyTenantLimit: number;
  readonly #hourlyGuestLimit: number;
  readonly #clock: () => Date;

  constructor(database: SqlDatabase, options: SqliteModelRequestQuotaOptions = {}) {
    this.#database = database;
    this.#dailyTenantLimit = limit(options.dailyTenantLimit ?? DEFAULT_MODEL_REQUEST_QUOTA_LIMITS.tenantDaily, "daily tenant limit");
    this.#hourlyGuestLimit = limit(options.hourlyGuestLimit ?? DEFAULT_MODEL_REQUEST_QUOTA_LIMITS.guestHourly, "hourly guest limit");
    this.#clock = options.clock ?? (() => new Date());
    this.#database.exec(MODEL_REQUEST_QUOTA_SCHEMA);
  }

  async reserve(input: { readonly tenantId: string; readonly guestId: string }): Promise<ModelRequestQuotaReservation> {
    if (!validId(input.tenantId) || !validId(input.guestId)) throw new Error("Model request quota identity is invalid");
    const now = this.#clock();
    if (!Number.isFinite(now.getTime())) throw new Error("Model request quota clock is invalid");
    const dayKey = new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
    const hourAgo = now.getTime() - 60 * 60 * 1000;
    return this.#database.transaction(() => {
      const tenant = this.#database.prepare("SELECT reservation_count FROM model_request_tenant_daily WHERE tenant_id = ? AND day_key = ?").get([input.tenantId, dayKey]);
      this.#database.prepare("DELETE FROM model_request_guest_reservations WHERE reserved_at <= ?").run([hourAgo]);
      const guest = this.#database.prepare("SELECT COUNT(*) AS reservation_count FROM model_request_guest_reservations WHERE tenant_id = ? AND guest_id = ? AND reserved_at > ?").get([input.tenantId, input.guestId, hourAgo]);
      const dailyCount = readCount(tenant?.reservation_count);
      const hourlyCount = readCount(guest?.reservation_count);
      if (hourlyCount >= this.#hourlyGuestLimit) return { reserved: false, reason: "guest_hour_limit" } as const;
      if (dailyCount >= this.#dailyTenantLimit) return { reserved: false, reason: "tenant_day_limit" } as const;
      this.#database.prepare(`INSERT INTO model_request_tenant_daily (tenant_id, day_key, reservation_count) VALUES (?, ?, 1)
        ON CONFLICT(tenant_id, day_key) DO UPDATE SET reservation_count = reservation_count + 1`).run([input.tenantId, dayKey]);
      this.#database.prepare("INSERT INTO model_request_guest_reservations (tenant_id, guest_id, reserved_at) VALUES (?, ?, ?)").run([input.tenantId, input.guestId, now.getTime()]);
      return { reserved: true } as const;
    });
  }
}

function validId(value: string): boolean {
  return typeof value === "string" && value.trim() !== "" && value.length <= 200;
}

function limit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new Error(`The ${label} must be a whole number from 1 to 1000000`);
  return value;
}

function readCount(value: string | number | bigint | Uint8Array | null | undefined): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" && typeof value !== "bigint") throw new Error("Model request quota state is unavailable");
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Model request quota state is unavailable");
  return count;
}
