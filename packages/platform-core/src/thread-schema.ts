/**
 * Issue 03m (ADR 0101, ADR 0107 decision 11, ADR 0096): the platform-owned thread DDL. `guest_threads`, `guest_thread_lane_events`
 * and `guest_session_bindings` are defined here once. The platform migrations (apps/cloudflare/src/schema.ts) and the shortlet store
 * (domains/shortlet/src/guest-interaction-store.ts, which delegates to this module) both apply these statements. The text is a pure move:
 * no column, constraint, index or migration changed. This module imports nothing, so it stays testable from node.
 */

/**
 * Issue 03e (ADR 0107 decision 11, owner decision O4): one row per lane event, beside guest_threads. Only the write path and the
 * export touch it; no application code selects from it (AC7). Platform migration 5 applies the same DDL to existing objects.
 */
export const LANE_EVENT_SCHEMA = `
      CREATE TABLE IF NOT EXISTS guest_thread_lane_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        thread_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'receipt')),
        text_redacted TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (thread_id, task_id, seq)
      );
    `;

/** Table DDL, applied by the schema migrations (apps/cloudflare/src/schema.ts) and by this store's constructor. */
export const THREAD_SESSION_SCHEMA = `
      CREATE TABLE IF NOT EXISTS guest_session_bindings (
        session_id TEXT PRIMARY KEY,
        session_secret_hash TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_guest_sessions_principal
        ON guest_session_bindings (principal_id, tenant_id);

      CREATE TABLE IF NOT EXISTS guest_threads (
        thread_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        thread_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_guest_threads_principal
        ON guest_threads (principal_id, tenant_id);
      ${LANE_EVENT_SCHEMA}
    `;
