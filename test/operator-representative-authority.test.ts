import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPlatformCommandEnvelope, type CommandPrincipal } from "../packages/platform-core/src/index.js";
import { SqliteOperatorRepresentativeGrantStore } from "../domains/shortlet/src/index.js";

const now = new Date("2026-08-01T12:00:00.000Z");
const human: CommandPrincipal = { id: "staff-1", role: "authorized_staff", tenantId: "tenant-a" };
const admin: CommandPrincipal = { id: "admin-1", role: "admin", tenantId: "tenant-a" };
const payload = { actorId: "person-1", operatorId: "operator-1", expiresAtIso: "2026-08-01T13:00:00Z", responsiblePersonVerifiedAtIso: "2026-08-01T11:00:00Z", verificationReference: "verification-record-1" };
const command = <T>(commandName: string, principal: CommandPrincipal, value: T, idempotencyKey: string) => createPlatformCommandEnvelope({ commandName, principal, payload: value, idempotencyKey });
async function database() { const directory = await mkdtemp(join(tmpdir(), "operator-representative-")); return { directory, path: join(directory, "grants.sqlite") }; }

 test("Authorized platform humans create durable explicit Operator representative grants", async () => {
  const db = await database(); const clock = () => now; const store = new SqliteOperatorRepresentativeGrantStore(db.path, { clock });
  const grant = store.createGrant(command("operator_representative.grant", human, payload, "create-1"));
  const adminGrant = store.createGrant(command("operator_representative.grant", admin, { ...payload, actorId: "person-admin" }, "create-admin"));
  assert.match(grant.grantId, /^grant-[0-9a-f-]+$/); assert.equal(grant.tenantId, "tenant-a"); assert.notEqual(grant.actorId, grant.operatorId);
  assert.deepEqual(Object.keys(grant).sort(), ["actorId", "authorizedGrantorId", "expiresAtIso", "grantId", "grantedAtIso", "operatorId", "permission", "responsiblePersonVerifiedAtIso", "tenantId", "verificationReference"].sort());
  store.close(); const reopened = new SqliteOperatorRepresentativeGrantStore(db.path, { clock }); assert.deepEqual(reopened.listGrants(), [grant, adminGrant]);
  for (const role of ["guest", "operator", "agent", "system"] as const) assert.throws(() => reopened.createGrant(command("operator_representative.grant", { id: "x", role, tenantId: "tenant-a" }, payload, `bad-${role}`)));
  assert.throws(() => reopened.createGrant(command("operator_representative.grant", { ...human, id: payload.actorId }, payload, "self")));
  assert.throws(() => reopened.createGrant(command("operator_representative.grant", { id: "staff-2", role: "admin" }, payload, "no-tenant")));
  assert.throws(() => reopened.createGrant(command("operator_representative.grant", human, { ...payload, expiresAtIso: "not-a-date" }, "bad-expiry")));
  assert.throws(() => reopened.createGrant(command("operator_representative.grant", human, { ...payload, expiresAtIso: now.toISOString() }, "equal-expiry")));
  const withoutIdempotency = { ...command("operator_representative.grant", human, { ...payload, actorId: "person-no-key" }, "ignored"), idempotencyKey: undefined };
  assert.throws(() => reopened.createGrant(withoutIdempotency));
  assert.throws(() => reopened.createGrant(command("operator_representative.grant", human, { ...payload, responsiblePersonVerifiedAtIso: "2026-08-01T12:00:01Z" }, "future-verification")));
  for (const reference of ["http://evidence.test/a", "https://evidence.test/a"]) assert.throws(() => reopened.createGrant(command("operator_representative.grant", human, { ...payload, verificationReference: reference }, `url-${reference}`)));
  reopened.close(); await rm(db.directory, { recursive: true, force: true });
 });

 test("Operator representative authority fails closed outside an active matching grant", async () => {
  const db = await database(); let current = new Date(now); const store = new SqliteOperatorRepresentativeGrantStore(db.path, { clock: () => current });
  store.createGrant(command("operator_representative.grant", human, payload, "active"));
  assert.equal(store.canActForOperator({ actorId: "person-1", operatorId: "operator-1", tenantId: "tenant-a" }), true);
  assert.equal(store.canActForOperator({ actorId: "operator-1", operatorId: "operator-1", tenantId: "tenant-a" }), false);
  for (const input of [{ actorId: "other", operatorId: "operator-1", tenantId: "tenant-a" }, { actorId: "person-1", operatorId: "other", tenantId: "tenant-a" }, { actorId: "person-1", operatorId: "operator-1", tenantId: "tenant-b" }]) assert.equal(store.canActForOperator(input), false);
  assert.equal(store.canActForOperator({ actorId: "none", operatorId: "none", tenantId: "tenant-a" }), false);
  current = new Date("2026-08-01T13:00:00Z"); assert.equal(store.canActForOperator({ actorId: "person-1", operatorId: "operator-1", tenantId: "tenant-a" }), false);
  const second = store.createGrant(command("operator_representative.grant", { ...human, id: "staff-2" }, { ...payload, actorId: "person-2", expiresAtIso: "2026-08-01T14:00:00Z" }, "second"));
  assert.equal(store.canActForOperator({ actorId: "person-2", operatorId: "operator-1", tenantId: "tenant-a" }), true); assert.notEqual(second.actorId, second.operatorId);
  const third = store.createGrant(command("operator_representative.grant", { ...human, id: "staff-3" }, { ...payload, actorId: "person-1", operatorId: "operator-2", expiresAtIso: "2026-08-01T14:00:00Z" }, "third"));
  assert.equal(store.canActForOperator({ actorId: "person-1", operatorId: "operator-2", tenantId: "tenant-a" }), true);
  current = new Date("2026-08-01T13:00:00Z"); assert.equal(store.canActForOperator({ actorId: "person-2", operatorId: "operator-1", tenantId: "tenant-a" }), true);
  const fourth = store.createGrant(command("operator_representative.grant", { ...human, id: "staff-4" }, { ...payload, actorId: "person-1", expiresAtIso: "2026-08-01T14:00:00Z" }, "fourth")); assert.equal(store.canActForOperator({ actorId: fourth.actorId, operatorId: fourth.operatorId, tenantId: fourth.tenantId }), true);
  store.revokeGrant(command("operator_representative.revoke", admin, { grantId: second.grantId }, "revoke-second")); assert.equal(store.canActForOperator({ actorId: "person-2", operatorId: "operator-1", tenantId: "tenant-a" }), false);
  assert.ok(third); store.close(); await rm(db.directory, { recursive: true, force: true });
 });

 test("Authorized revocation immediately removes Operator representative authority and preserves history", async () => {
  const db = await database(); let current = new Date(now); const store = new SqliteOperatorRepresentativeGrantStore(db.path, { clock: () => current });
  const grant = store.createGrant(command("operator_representative.grant", human, payload, "revocation-create"));
  const revoked = store.revokeGrant(command("operator_representative.revoke", admin, { grantId: grant.grantId }, "revoke-1"));
  assert.equal(store.canActForOperator({ actorId: grant.actorId, operatorId: grant.operatorId, tenantId: grant.tenantId }), false); assert.equal(revoked.revokedById, "admin-1"); assert.equal(revoked.revokedAtIso, now.toISOString()); assert.equal(store.listGrants().length, 1); assert.equal(store.auditEntries().length, 2);
  assert.throws(() => store.revokeGrant(command("operator_representative.revoke", { id: "other", role: "authorized_staff", tenantId: "tenant-b" }, { grantId: grant.grantId }, "cross")));
  for (const role of ["operator", "agent", "system", "guest"] as const) assert.throws(() => store.revokeGrant(command("operator_representative.revoke", { id: role, role, tenantId: "tenant-a" }, { grantId: grant.grantId }, `unauthorized-${role}`)));
  const revokeWithoutIdempotency = { ...command("operator_representative.revoke", admin, { grantId: grant.grantId }, "ignored-revoke"), idempotencyKey: undefined };
  assert.throws(() => store.revokeGrant(revokeWithoutIdempotency));
  current = new Date("2026-08-01T13:30:00Z"); assert.equal(store.canActForOperator({ actorId: grant.actorId, operatorId: grant.operatorId, tenantId: grant.tenantId }), false);
  store.close(); const reopened = new SqliteOperatorRepresentativeGrantStore(db.path, { clock: () => current }); assert.equal(reopened.listGrants()[0]?.revokedById, "admin-1"); assert.equal(reopened.canActForOperator({ actorId: grant.actorId, operatorId: grant.operatorId, tenantId: grant.tenantId }), false); reopened.close(); await rm(db.directory, { recursive: true, force: true });
 });

 test("Representative grant commands are idempotent and audit only minimal transitions", async () => {
  const db = await database(); let current = new Date(now); const store = new SqliteOperatorRepresentativeGrantStore(db.path, { clock: () => current });
  const first = store.createGrant(command("operator_representative.grant", human, payload, "same-create")); const replay = store.createGrant(command("operator_representative.grant", human, payload, "same-create")); assert.deepEqual(replay, first); assert.equal(store.listGrants().length, 1); assert.equal(store.auditEntries().length, 1);
  const noKeyCreate = { ...command("operator_representative.grant", human, { ...payload, actorId: "person-no-key" }, "ignored"), idempotencyKey: undefined };
  assert.throws(() => store.createGrant(noKeyCreate)); assert.equal(store.listGrants().length, 1); assert.equal(store.auditEntries().length, 1);
  assert.throws(() => store.createGrant(command("operator_representative.grant", human, { ...payload, operatorId: "different" }, "same-create")));
  const revoked = store.revokeGrant(command("operator_representative.revoke", admin, { grantId: first.grantId }, "same-revoke")); const replayRevoke = store.revokeGrant(command("operator_representative.revoke", admin, { grantId: first.grantId }, "same-revoke")); assert.deepEqual(replayRevoke, revoked); assert.equal(store.auditEntries().filter((entry) => entry.transition === "revoked").length, 1);
  const noKeyRevoke = { ...command("operator_representative.revoke", admin, { grantId: first.grantId }, "ignored-revoke"), idempotencyKey: undefined };
  const auditCount = store.auditEntries().length; assert.throws(() => store.revokeGrant(noKeyRevoke)); assert.equal(store.auditEntries().length, auditCount);
  const serialized = JSON.stringify(store.auditEntries()); assert.doesNotMatch(serialized, /verification-record-1|http|passport|NIN|token|password/i);
  const expired = store.createGrant(command("operator_representative.grant", { ...human, id: "staff-4" }, { ...payload, actorId: "person-expired", expiresAtIso: "2026-08-01T12:01:00Z" }, "expired")); assert.ok(expired);
  assert.equal(store.canActForOperator({ actorId: "person-expired", operatorId: "operator-1", tenantId: "tenant-a" }), true);
  current = new Date("2026-08-01T12:01:00Z"); assert.equal(store.canActForOperator({ actorId: "person-expired", operatorId: "operator-1", tenantId: "tenant-a" }), false);
  const replacement = store.createGrant(command("operator_representative.grant", { ...human, id: "staff-5" }, { ...payload, actorId: "person-1", expiresAtIso: "2026-08-01T14:00:00Z" }, "replacement")); assert.equal(store.canActForOperator({ actorId: replacement.actorId, operatorId: replacement.operatorId, tenantId: replacement.tenantId }), true);
  store.close(); await rm(db.directory, { recursive: true, force: true });

  const corruptions = [
    "UPDATE operator_representative_grants SET expires_at_iso = 'invalid'",
    "UPDATE operator_representative_grants SET granted_at_iso = ''",
    "UPDATE operator_representative_grants SET revoked_by_id = 'staff-1' WHERE revoked_at_iso IS NULL",
    "UPDATE operator_representative_grants SET revoked_at_iso = 'invalid', revoked_by_id = 'staff-1'",
    "UPDATE operator_representative_grants SET responsible_person_verified_at_iso = '2026-08-01T13:00:00Z'"
  ];
  for (const sql of corruptions) {
    const corrupted = await database();
    const source = new SqliteOperatorRepresentativeGrantStore(corrupted.path, { clock: () => now });
    const valid = source.createGrant(command("operator_representative.grant", human, payload, `valid-${sql}`)); source.close();
    const raw = new DatabaseSync(corrupted.path); raw.exec(sql); raw.close();
    const reopened = new SqliteOperatorRepresentativeGrantStore(corrupted.path, { clock: () => now });
    assert.equal(reopened.canActForOperator({ actorId: valid.actorId, operatorId: valid.operatorId, tenantId: valid.tenantId }), false);
    reopened.close(); await rm(corrupted.directory, { recursive: true, force: true });
  }
 });
