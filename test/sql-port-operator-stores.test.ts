import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { createPlatformCommandEnvelope } from "../packages/platform-core/src/envelope.js";
import { SqliteOperatorRepresentativeGrantStore } from "../domains/shortlet/src/operator-representative-authority.js";
import { SqliteOperatorSessionAuthority } from "../domains/shortlet/src/operator-session-authority.js";
import { LocalApartmentOwnerEnvironment } from "../apps/local-owner/src/local-owner-environment.js";

function pathSignaturesAreGone(): void {
  // @ts-expect-error 02d AC1: require the SQL port
  new SqliteOperatorRepresentativeGrantStore(":memory:");
  // @ts-expect-error 02d AC1: require the SQL port
  new SqliteOperatorSessionAuthority(":memory:");
}
void pathSignaturesAreGone;

test("02d AC1: Neither operator store opens a connection or accepts a path", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    new SqliteOperatorRepresentativeGrantStore(db).close();
    new SqliteOperatorSessionAuthority(db).close();
    assert.equal(db.prepare("SELECT 1 AS ok").get()?.ok, 1);
  } finally {
    db.close();
  }
});

test("02d AC2: Operator sessions survive environment restart and expired or revoked sessions fail closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "cf-operator-restart-"));
  const databasePath = join(directory, "pilot.sqlite");
  let now = new Date("2026-08-10T10:00:00Z");
  const config = { databasePath, clock: () => now };
  let env = new LocalApartmentOwnerEnvironment(config);
  try {
    const token = env.provisionOperatorAccessToken();
    const live = env.sessionAuthority.authenticateAccessToken(token);
    const revoked = env.sessionAuthority.authenticateAccessToken(
      env.provisionOperatorAccessToken(),
    );
    env.sessionAuthority.revokeSession(revoked.sessionId);
    const unconsumed = env.provisionOperatorAccessToken();
    env.close();
    env = new LocalApartmentOwnerEnvironment({ ...config, seedFixture: false });
    assert.deepEqual(
      env.sessionAuthority.resolveSession(live.sessionId, live.sessionSecret),
      live.principal,
    );
    assert.equal(
      env.sessionAuthority.resolveSession(
        revoked.sessionId,
        revoked.sessionSecret,
      ),
      null,
    );
    assert.throws(
      () => env.sessionAuthority.authenticateAccessToken(token),
      /consumed/,
    );
    now = new Date(now.getTime() + 30 * 60_000);
    assert.throws(
      () => env.sessionAuthority.authenticateAccessToken(unconsumed),
      /expired/,
    );
    assert.ok(
      env.sessionAuthority.resolveSession(live.sessionId, live.sessionSecret),
    );
    now = new Date("2026-08-10T22:00:00Z");
    env.close();
    env = new LocalApartmentOwnerEnvironment({ ...config, seedFixture: false });
    assert.equal(
      env.sessionAuthority.resolveSession(live.sessionId, live.sessionSecret),
      null,
    );
    assert.equal(
      env.sessionAuthority.resolveSession(live.sessionId, "wrong-secret"),
      null,
    );
  } finally {
    env.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("02d AC3: Revoking a representative grant is atomic and a mid-revoke throw preserves grant and audit", () => {
  const db = openNodeSqliteDatabase(":memory:");
  try {
    const now = new Date("2026-08-10T10:00:00Z");
    const store = new SqliteOperatorRepresentativeGrantStore(db, {
      clock: () => now,
    });
    const principal = {
      id: "staff",
      role: "authorized_staff" as const,
      tenantId: "tenant",
    };
    const grant = store.createGrant(
      createPlatformCommandEnvelope({
        commandName: "operator_representative.grant",
        principal,
        payload: {
          actorId: "actor",
          operatorId: "operator",
          expiresAtIso: "2026-08-11T10:00:00Z",
          responsiblePersonVerifiedAtIso: now.toISOString(),
        },
      }),
    );
    const audit = store.auditEntries();
    db.exec(
      "CREATE TRIGGER fail_revoke BEFORE INSERT ON operator_representative_audit WHEN NEW.transition = 'revoked' BEGIN SELECT RAISE(ABORT, 'mid-revoke'); END;",
    );
    const revoke = createPlatformCommandEnvelope({
      commandName: "operator_representative.revoke",
      principal,
      payload: { grantId: grant.grantId },
    });
    assert.throws(
      () => db.transaction(() => store.revokeGrant(revoke)),
      /mid-revoke/,
    );
    assert.equal(
      store.canActForOperator({
        actorId: grant.actorId,
        operatorId: grant.operatorId,
        tenantId: grant.tenantId,
      }),
      true,
    );
    assert.deepEqual(store.auditEntries(), audit);
    db.exec("DROP TRIGGER fail_revoke");
    store.revokeGrant(revoke);
    assert.equal(
      store.canActForOperator({
        actorId: grant.actorId,
        operatorId: grant.operatorId,
        tenantId: grant.tenantId,
      }),
      false,
    );
    assert.equal(store.auditEntries().length, audit.length + 1);
  } finally {
    db.close();
  }
});

test("02d AC4: No databasePath field remains on a converted store", () => {
  for (const name of [
    "availability-store",
    "guest-interaction-store",
    "booking-state",
    "booking-payment-journey",
    "operator-representative-authority",
  ]) {
    const source = readFileSync(`domains/shortlet/src/${name}.ts`, "utf8");
    assert.doesNotMatch(source, /readonly\s+databasePath\s*:/);
  }
});
