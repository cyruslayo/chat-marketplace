import assert from "node:assert/strict";
import test from "node:test";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import {
  SqliteAvailabilityStore,
  AvailabilityConflictError,
} from "../domains/shortlet/src/availability-store.js";
import { SqliteGuestInteractionStore } from "../domains/shortlet/src/guest-interaction-store.js";
import { SqliteLivePaymentAttemptRegistry } from "../domains/shortlet/src/payment-attempt.js";

// Compiled by npm run check; never opens an invalid connection.
function pathSignaturesAreGone(): void {
  // @ts-expect-error AC1: only the injected port is accepted
  new SqliteAvailabilityStore(":memory:");
  // @ts-expect-error AC1: only the injected port is accepted
  new SqliteGuestInteractionStore(":memory:");
}
void pathSignaturesAreGone;

test("02c AC1: Neither store accepts a path or opens or closes a connection", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    new SqliteAvailabilityStore(db).close();
    new SqliteGuestInteractionStore(db).close();
    assert.equal(db.prepare("SELECT 1 AS ok").get()?.ok, 1);
  } finally {
    db.close();
  }
});

test("02c AC2: The inventory hold is still exclusive inside an overlapping transaction", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const store = new SqliteAvailabilityStore(db);
    const input = {
      commitmentId: "first",
      unitId: "unit",
      kind: "operator_hold" as const,
      start: "2030-10-01",
      end: "2030-10-03",
      createdAt: "2030-09-30T12:00:00Z",
      expiresAt: "2030-09-30T12:45:00Z",
    };
    db.transaction(() => {
      store.create(input);
      assert.throws(
        () => store.create({ ...input, commitmentId: "second" }),
        AvailabilityConflictError,
      );
      assert.equal(
        store.findActive(input.unitId, input.start, input.end, input.createdAt)
          .length,
        1,
      );
    });
    assert.equal(
      store.findCommitment("first", input.createdAt)?.state,
      "active",
    );
    assert.equal(store.findCommitment("second", input.createdAt), null);
  } finally {
    db.close();
  }
});

test("02c AC3: There is still at most one live payment attempt per booking", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const registry = new SqliteLivePaymentAttemptRegistry(
      new SqliteGuestInteractionStore(db),
    );
    const startedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString();
    const input = {
      offerId: "offer",
      method: "fresh_card" as const,
      attemptId: "first",
      purpose: "stay" as const,
      startedAt,
      expiresAt,
    };
    registry.acquire(input);
    assert.throws(
      () => registry.acquire({ ...input, attemptId: "second" }),
      /already owns/,
    );
    const restored = new SqliteLivePaymentAttemptRegistry(
      new SqliteGuestInteractionStore(db),
    );
    assert.equal(restored.current("offer")?.attemptId, "first");
    assert.throws(
      () => restored.acquire({ ...input, attemptId: "third" }),
      /already owns/,
    );
  } finally {
    db.close();
  }
});

test("02c AC4: Shared-store state survives reconstruction and outer rollback", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const input = {
      commitmentId: "rollback",
      unitId: "unit",
      kind: "operator_hold" as const,
      start: "2030-10-01",
      end: "2030-10-03",
      createdAt: "2030-09-30T12:00:00Z",
    };
    const store = new SqliteAvailabilityStore(db);
    assert.throws(
      () =>
        db.transaction(() => {
          store.create(input);
          throw new Error("abort");
        }),
      /abort/,
    );
    assert.equal(
      new SqliteAvailabilityStore(db).findCommitment(
        "rollback",
        input.createdAt,
      ),
      null,
    );
  } finally {
    db.close();
  }
});
