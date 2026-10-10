import type { SqlDatabase } from "../../../packages/platform-core/src/sql-database.js";
import { SqliteAuditLog } from "../../../packages/platform-core/src/sqlite-audit-log.js";
import { seedIssue01Units } from "../../../domains/shortlet/src/browse.js";
import { SqliteReceiptBlobStore } from "../../../domains/shortlet/src/receipt-blob-store.js";
import { SqliteManualTransferStore } from "../../../domains/shortlet/src/manual-transfer.js";
import { createProvisionedOperator } from "../../../domains/shortlet/src/operator.js";
import { SqliteOperatorRepository } from "../../../domains/shortlet/src/sqlite-operator-repository.js";
import { SqliteUnitRepository } from "../../../domains/shortlet/src/sqlite-unit-repository.js";

/**
 * Slice 16 fixtures: a synthetic populated database built through the real stores, shared by the workerd and the
 * Node migration tests (AGENTS.md: no duplicated fixtures). Only synthetic values appear here.
 */
export const FIXTURE_TENANT = "tenant-migration-fixture";
const FIXED_NOW = new Date("2026-10-01T09:00:00.000Z");

/** Receipt bytes stored the way the Node composition does it today (07a): the `receipt_blobs` table. */
const BLOB_KEY = "5b1f7c2e-0000-4000-8000-00000000b10b";

export async function populateSource(database: SqlDatabase): Promise<void> {
  const units = new SqliteUnitRepository(database);
  seedIssue01Units(units);
  const operators = new SqliteOperatorRepository(database, { clock: () => FIXED_NOW });
  for (const unit of units.findAll()) {
    if (operators.findById(unit.operator.id)) continue;
    operators.create(createProvisionedOperator({ id: unit.operator.id, tenantId: FIXTURE_TENANT, name: unit.operator.name?.trim() || "Fixture Operator", now: FIXED_NOW }));
  }
  new SqliteAuditLog(database).record({ action: "fixture.seeded", recordedAt: FIXED_NOW.toISOString() } as never);

  // Creates manual_transfers and the current manual_transfer_receipts shape (07a).
  new SqliteManualTransferStore(database, new SqliteReceiptBlobStore(database));
  // A legacy receipt keeps its bytes inline and has no object key.
  database.prepare(
    "INSERT INTO manual_transfer_receipts (receipt_id, transfer_id, content_type, bytes, object_key, size_bytes) VALUES ($receipt_id, $transfer_id, $content_type, $bytes, NULL, NULL)",
  ).run({ $receipt_id: "receipt-legacy-001", $transfer_id: "transfer-fixture-001", $content_type: "image/png", $bytes: new Uint8Array([137, 80, 78, 71, 0, 255]) });
  // A current receipt keeps its bytes in the blob store under an opaque key (07a), with NULL inline bytes.
  database.prepare(
    "INSERT INTO manual_transfer_receipts (receipt_id, transfer_id, content_type, bytes, object_key, size_bytes) VALUES ($receipt_id, $transfer_id, $content_type, NULL, $object_key, $size_bytes)",
  ).run({ $receipt_id: "receipt-current-002", $transfer_id: "transfer-fixture-002", $content_type: "application/pdf", $object_key: BLOB_KEY, $size_bytes: 4 });
  await new SqliteReceiptBlobStore(database).put(BLOB_KEY, new Uint8Array([37, 80, 68, 70]), "application/pdf");
}
