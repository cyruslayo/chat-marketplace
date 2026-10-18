import { CUTOVER_STATE_DDL, CUTOVER_STATE_MIGRATION_VERSION } from "../../../packages/platform-core/src/data-migration.js";
import type { SchemaMigration } from "../../../packages/platform-core/src/schema-migrations.js";
import { AUDIT_LOG_SCHEMA } from "../../../packages/platform-core/src/sqlite-audit-log.js";
import { TELEMETRY_SCHEMA } from "../../../packages/platform-core/src/sqlite-telemetry.js";
import { AVAILABILITY_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { BANK_TRANSFER_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { BOOKING_PAYMENT_JOURNEYS_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { BOOKING_STATE_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { CHECKIN_SUPPORT_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { GUEST_IDENTITY_ASSURANCE_SCHEMA } from "../../../domains/shortlet/src/guest-identity-assurance.js";
import { GUEST_INTERACTION_SCHEMA, GUEST_REQUEST_CONTACT_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { MANUAL_TRANSFERS_SCHEMA, MANUAL_TRANSFER_RECEIPTS_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { OWNER_PAYABLE_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { OPERATOR_REPRESENTATIVE_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { OPERATOR_SESSION_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { OPERATOR_ENFORCEMENT_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { OPERATOR_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { REVENUE_ACCOUNTING_SCHEMA, REVENUE_COMPATIBILITY_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { RESERVE_PAYOUT_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { UNIT_SCHEMA } from "../../../domains/shortlet/src/index.js";
import { PILOT_NOTIFICATIONS_SCHEMA } from "../../pilot/src/notifications/pilot-notifier.js";
import { GUEST_ACCOUNT_SCHEMA } from "../../../packages/platform-core/src/accounts/authority.js";
import { GUEST_ACCOUNT_LINK_SCHEMA } from "../../../packages/platform-core/src/accounts/links.js";
import { GUEST_CONTACT_SCHEMA } from "../../../packages/platform-core/src/accounts/contact.js";
import { THREAD_SESSION_SCHEMA } from "../../../domains/shortlet/src/index.js";

/**
 * Slice 16 / D3: the Durable Object's schema, as ordered migrations. The object applies them on startup
 * (shortlet-pilot-do.ts) and an import target is migrated by the same function (scripts/export-node-sqlite.ts --migrate),
 * so fresh and migrated installs share one path.
 *
 * Migration 1 is the baseline: the DDL each store owns, exported next to its class and also run by that store's
 * constructor (IF NOT EXISTS), so nothing is copied. It lists every table the Node composition creates, except
 * `receipt_blobs`, whose bytes move to R2 (07a, ADR 0090) and are not rows in the object. Migration 2 adds the one-way
 * cutover flag (D1). A new migration is appended here; an applied one is never edited.
 *
 * Node composition check: `test/export-node-sqlite.test.ts` and `apps/cloudflare/test/data-migration.spec.ts` fail if a
 * table the stores create is missing from this list.
 */
/**
 * The local booking tables (`LocalBookingContractRepository`, apps/local-guest/src/fixture.ts). Frozen here as a literal so
 * the production schema does not depend on the local fixture module. `test/schema-migrations.test.ts` fails if this text and
 * the fixture's `LOCAL_BOOKING_SCHEMA` drift apart (F10). An applied migration is never edited, so change both together and
 * add a new migration for any schema change.
 */
export const LOCAL_BOOKING_DDL = `
      CREATE TABLE IF NOT EXISTS local_booking_contracts (
        contract_id TEXT PRIMARY KEY,
        contract_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_booking_reservations (
        reservation_id TEXT PRIMARY KEY,
        reservation_json TEXT NOT NULL
      );
    `;

const BASELINE_STATEMENTS: readonly string[] = [
  UNIT_SCHEMA,
  OPERATOR_SCHEMA,
  AVAILABILITY_SCHEMA,
  BOOKING_STATE_SCHEMA,
  BOOKING_PAYMENT_JOURNEYS_SCHEMA,
  CHECKIN_SUPPORT_SCHEMA,
  RESERVE_PAYOUT_SCHEMA,
  OPERATOR_ENFORCEMENT_SCHEMA,
  OPERATOR_SESSION_SCHEMA,
  OPERATOR_REPRESENTATIVE_SCHEMA,
  GUEST_INTERACTION_SCHEMA,
  MANUAL_TRANSFERS_SCHEMA,
  MANUAL_TRANSFER_RECEIPTS_SCHEMA,
  OWNER_PAYABLE_SCHEMA,
  REVENUE_ACCOUNTING_SCHEMA,
  REVENUE_COMPATIBILITY_SCHEMA,
  BANK_TRANSFER_SCHEMA,
  PILOT_NOTIFICATIONS_SCHEMA,
  LOCAL_BOOKING_DDL,
];

export const SHORTLET_SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  { version: 1, name: "baseline: the tables the stores create", statements: BASELINE_STATEMENTS },
  { version: CUTOVER_STATE_MIGRATION_VERSION, name: "one-way cutover flag", statements: [CUTOVER_STATE_DDL] },
  { version: 3, name: "shortlet booking request contact snapshots", statements: [GUEST_REQUEST_CONTACT_SCHEMA] },
  // Personal-data table (ADR 0094, issue 09): exported in the daily export under the issue 05 precedent, flagged for the DPIA. Not a credential.
  { version: 4, name: "guest accounts: identity assurance anchored to the account", statements: [GUEST_IDENTITY_ASSURANCE_SCHEMA] },
];

/** The version the import checks for before it writes anything (ops-import.ts). */
export const SHORTLET_SCHEMA_VERSION = SHORTLET_SCHEMA_MIGRATIONS.length;

/** ADR 0101: a distinct migration ledger and schema authority for the per-tenant platform Durable Object. */
export const PLATFORM_SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  { version: 1, name: "platform accounts, links, contacts and interaction threads", statements: [AUDIT_LOG_SCHEMA, TELEMETRY_SCHEMA, GUEST_ACCOUNT_SCHEMA, GUEST_ACCOUNT_LINK_SCHEMA, GUEST_CONTACT_SCHEMA, THREAD_SESSION_SCHEMA] },
  { version: CUTOVER_STATE_MIGRATION_VERSION, name: "one-way platform cutover flag", statements: [CUTOVER_STATE_DDL] },
  { version: 3, name: "retryable post-commit email assurance cleanup", statements: [
    "ALTER TABLE guest_account_email_commands ADD COLUMN assurance_cleanup_completed INTEGER NOT NULL DEFAULT 0 CHECK (assurance_cleanup_completed IN (0, 1))",
  ] },
];

export const PLATFORM_SCHEMA_VERSION = PLATFORM_SCHEMA_MIGRATIONS.length;

/**
 * ADR 0101: CommerceMarket has its own migration ledger and owns every commerce transaction table. The domain pack's
 * migrations arrive from `createCommercePack(...).migrations` (ADR 0099: the domain façade exports only the pack), and the
 * cutover flag is appended after them, so its version follows the pack's migration count.
 */
export function commerceMigrationsWithCutover(packMigrations: readonly SchemaMigration[]): readonly SchemaMigration[] {
  return [...packMigrations, { version: packMigrations.length + 1, name: "one-way commerce cutover flag", statements: [CUTOVER_STATE_DDL] }];
}
