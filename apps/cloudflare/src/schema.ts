import { CUTOVER_STATE_DDL } from "../../../packages/platform-core/src/data-migration.js";
import type { SchemaMigration } from "../../../packages/platform-core/src/schema-migrations.js";
import { AUDIT_LOG_SCHEMA } from "../../../packages/platform-core/src/sqlite-audit-log.js";
import { TELEMETRY_SCHEMA } from "../../../packages/platform-core/src/sqlite-telemetry.js";
import { AVAILABILITY_SCHEMA } from "../../../domains/shortlet/src/availability-store.js";
import { BANK_TRANSFER_SCHEMA } from "../../../domains/shortlet/src/bank-transfer.js";
import { BOOKING_PAYMENT_JOURNEYS_SCHEMA } from "../../../domains/shortlet/src/booking-payment-journey.js";
import { BOOKING_STATE_SCHEMA } from "../../../domains/shortlet/src/booking-state.js";
import { CHECKIN_SUPPORT_SCHEMA } from "../../../domains/shortlet/src/checkin-support.js";
import { GUEST_ACCOUNT_SCHEMA } from "../../../domains/shortlet/src/guest-account-authority.js";
import { GUEST_CONTACT_SCHEMA } from "../../../domains/shortlet/src/guest-contact.js";
import { GUEST_INTERACTION_SCHEMA } from "../../../domains/shortlet/src/guest-interaction-store.js";
import { MANUAL_TRANSFERS_SCHEMA, MANUAL_TRANSFER_RECEIPTS_SCHEMA } from "../../../domains/shortlet/src/manual-transfer.js";
import { OWNER_PAYABLE_SCHEMA } from "../../../domains/shortlet/src/owner-payable.js";
import { OPERATOR_REPRESENTATIVE_SCHEMA } from "../../../domains/shortlet/src/operator-representative-authority.js";
import { OPERATOR_SESSION_SCHEMA } from "../../../domains/shortlet/src/operator-session-authority.js";
import { OPERATOR_ENFORCEMENT_SCHEMA } from "../../../domains/shortlet/src/sqlite-operator-enforcement-state.js";
import { OPERATOR_SCHEMA } from "../../../domains/shortlet/src/sqlite-operator-repository.js";
import { REVENUE_ACCOUNTING_SCHEMA, REVENUE_COMPATIBILITY_SCHEMA } from "../../../domains/shortlet/src/sqlite-revenue-accounting.js";
import { RESERVE_PAYOUT_SCHEMA } from "../../../domains/shortlet/src/sqlite-reserve-payout-state.js";
import { UNIT_SCHEMA } from "../../../domains/shortlet/src/sqlite-unit-repository.js";
import { PILOT_NOTIFICATIONS_SCHEMA } from "../../pilot/src/notifications/pilot-notifier.js";
import { LOCAL_BOOKING_SCHEMA } from "../../local-guest/src/fixture.js";

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
const BASELINE_STATEMENTS: readonly string[] = [
  AUDIT_LOG_SCHEMA,
  TELEMETRY_SCHEMA,
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
  GUEST_ACCOUNT_SCHEMA,
  GUEST_INTERACTION_SCHEMA,
  GUEST_CONTACT_SCHEMA,
  MANUAL_TRANSFERS_SCHEMA,
  MANUAL_TRANSFER_RECEIPTS_SCHEMA,
  OWNER_PAYABLE_SCHEMA,
  REVENUE_ACCOUNTING_SCHEMA,
  REVENUE_COMPATIBILITY_SCHEMA,
  BANK_TRANSFER_SCHEMA,
  PILOT_NOTIFICATIONS_SCHEMA,
  LOCAL_BOOKING_SCHEMA,
];

export const SHORTLET_SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  { version: 1, name: "baseline: the tables the stores create", statements: BASELINE_STATEMENTS },
  { version: 2, name: "one-way cutover flag", statements: [CUTOVER_STATE_DDL] },
];

/** The version the import checks for before it writes anything (ops-import.ts). */
export const SHORTLET_SCHEMA_VERSION = SHORTLET_SCHEMA_MIGRATIONS.length;
