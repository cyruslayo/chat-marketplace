import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../apps/cloudflare/src/schema.js";
import { importBatch } from "../apps/cloudflare/src/ops-import.js";
import { applySchemaMigrations } from "../packages/platform-core/src/schema-migrations.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { AccountBackedGuestIdentityVerificationResultSource, DEFAULT_IDENTITY_ASSURANCE_REFERENCE_POLICY, SqliteGuestIdentityAssurance, identityAssuranceRowForImport } from "../domains/shortlet/src/guest-identity-assurance.js";
import { GuestCheckInIdentityEligibility } from "../domains/shortlet/src/guest-check-in-eligibility.js";
import { GuestAccountRuntime } from "../apps/local-guest/src/guest-account-runtime.js";
import { recordLocalVerifiedIdentity } from "./helpers/identity-assurance-fixture.js";
import {
  ASSURANCE_TENANT,
  EXPIRES_AT,
  VERIFIED_AT,
  createGuestIdentityAssuranceFixture,
  reservationFor,
  verifiedOutcome,
  type GuestIdentityAssuranceFixture,
} from "./helpers/guest-identity-assurance.js";

const T = ASSURANCE_TENANT;
const ADA = "ada@example.test";
const GRACE = "grace@example.test";
const NIN_V2_METHOD = "nigeria_nin_v2_biometric_kyc";

async function withFixture(run: (fixture: GuestIdentityAssuranceFixture) => void | Promise<void>): Promise<void> {
  const fixture = await createGuestIdentityAssuranceFixture();
  try {
    await run(fixture);
  } finally {
    await fixture.close();
  }
}

// AC1 ---------------------------------------------------------------------------------------------------------------

test("AC1: a recorded verified outcome is returned for the account from any linked principal", async () => {
  await withFixture(async (f) => {
    const session = f.signInDevice("guest-device-a", ADA);
    f.signInDevice("guest-device-b", ADA);
    const accountGuestId = session.account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, f.now())?.status, "verified");
    for (const guestId of ["guest-device-a", "guest-device-b"]) {
      assert.deepEqual(await f.source.getVerificationResult({ tenantId: T, guestId }), { tenantId: T, guestId, governmentIdVerified: true });
    }
  });
});

test("AC1 failure path: a principal not linked to the account gets null", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    assert.equal(await f.source.getVerificationResult({ tenantId: T, guestId: "guest-never-signed-in" }), null);
  });
});

test("AC1 failure path: a principal linked to a different account reads that account's empty result, never the verified one", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    const other = f.signInDevice("guest-other-account", GRACE);
    assert.notEqual(other.account.accountGuestId, accountGuestId);
    assert.equal((await f.source.getVerificationResult({ tenantId: T, guestId: "guest-other-account" }))?.governmentIdVerified, false);
    assert.equal(f.assurance.currentAssurance(other.account.accountGuestId, T, f.now()), null);
  });
});

test("AC1 failure path: a principal read under another tenant gets null", async () => {
  await withFixture(async (f) => {
    const session = f.signInDevice("guest-device-a", ADA);
    f.assurance.recordOutcome(verifiedOutcome(session.account.accountGuestId));
    assert.equal(await f.source.getVerificationResult({ tenantId: "tenant-other", guestId: "guest-device-a" }), null);
    assert.equal(await f.source.getVerificationResult({ tenantId: "", guestId: "guest-device-a" }), null);
    assert.equal(f.assurance.currentAssurance(session.account.accountGuestId, "tenant-other", f.now()), null);
  });
});

test("AC1 failure path: an outcome for an account of another tenant or a missing account is refused", async () => {
  await withFixture(async (f) => {
    const session = f.signInDevice("guest-device-a", ADA);
    const accountGuestId = session.account.accountGuestId;
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { tenantId: "tenant-other" })), /active Guest Account/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome("gacct-does-not-exist")), /active Guest Account/);
    assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
  });
});

test("AC1 failure path: an outcome for a closed Guest Account of this tenant is refused, as for a missing account", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.database.prepare("UPDATE guest_accounts SET status = 'closed' WHERE account_guest_id = ?").run([accountGuestId]);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId)), /active Guest Account/);
    assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
  });
});

test("AC1: the test-only fixture records a verified outcome that the account-backed source returns", async () => {
  await withFixture(async (f) => {
    const session = f.signInDevice("guest-device-a", ADA);
    recordLocalVerifiedIdentity(f.assurance, { tenantId: T, accountGuestId: session.account.accountGuestId, verifiedAt: VERIFIED_AT, expiresAt: EXPIRES_AT });
    assert.equal((await f.source.getVerificationResult({ tenantId: T, guestId: "guest-device-a" }))?.governmentIdVerified, true);
  });
});

// AC2 ---------------------------------------------------------------------------------------------------------------

test("AC2: an outcome whose explicit expiresAt has passed reads as expired at the next call without any background job", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, new Date(Date.parse(EXPIRES_AT) - 1))?.status, "verified");
    // At the explicit expiry instant the result is expired (ADR 0094: now < expiresAt is required).
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, new Date(EXPIRES_AT))?.status, "expired");
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, new Date("2030-01-01T00:00:00.000Z"))?.status, "expired");
    // Lazy: nothing was rewritten by the reads, so the stored status is still the recorded verified outcome.
    assert.equal(f.database.prepare("SELECT status FROM guest_identity_assurance WHERE account_guest_id = ?").get([accountGuestId])?.status, "verified");
    f.setNow(EXPIRES_AT);
    assert.equal((await f.source.getVerificationResult({ tenantId: T, guestId: "guest-device-a" }))?.governmentIdVerified, false);
  });
});

test("AC2 failure path: a verified outcome without an explicit expiresAt is refused, so no default expiry applies", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    for (const expiresAt of [undefined, null, ""]) {
      assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { expiresAt })), /expiresAt/);
    }
    assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
  });
});

test("AC2 failure path: a verified outcome with an invalid verifiedAt, or an expiry not later than verification, is refused", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { verifiedAt: null })), /verifiedAt/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { verifiedAt: "not-a-timestamp" })), /verifiedAt/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { expiresAt: "not-a-timestamp" })), /expiresAt/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { expiresAt: VERIFIED_AT })), /expiresAt/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { expiresAt: "2026-10-09T09:00:00.000Z" })), /expiresAt/);
    assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
  });
});

test("AC2 failure path: a stored verified result with no explicit expiry never reads as current", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    // A row written around the store's validation (for example by a bad import) must not be read as current assurance.
    f.database.prepare(`INSERT INTO guest_identity_assurance (tenant_id, account_guest_id, level, method, status, verified_at, expires_at, provider_reference)
      VALUES (?, ?, 'government-ID-verified', ?, 'verified', ?, NULL, NULL)`).run([T, accountGuestId, NIN_V2_METHOD, VERIFIED_AT]);
    assert.throws(() => f.assurance.currentAssurance(accountGuestId, T, f.now()), /malformed/);
    assert.deepEqual(await f.eligibility.evaluate(reservationFor("guest-device-a")), { eligible: false, reason: "not_verified" });
  });
});

test("Hardening: currentAssurance refuses an invalid clock instant rather than reading expiry against it", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    assert.throws(() => f.assurance.currentAssurance(accountGuestId, T, new Date("not-a-date")), /valid clock/);
  });
});

test("Hardening: a verifiedAt later than the injected clock is refused, and one equal to it is accepted", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    // The fixture clock is VERIFIED_AT, so one millisecond later is in the future and must be refused.
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { verifiedAt: "2026-10-10T09:00:00.001Z" })), /verifiedAt/);
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { verifiedAt: VERIFIED_AT }));
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, f.now())?.status, "verified");
  });
});

test("Hardening: a closed Guest Account has no current outcome and its principals resolve to no account", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    f.database.prepare("UPDATE guest_accounts SET status = 'closed' WHERE account_guest_id = ?").run([accountGuestId]);
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, f.now())?.status, "verified");
    assert.equal(f.links.accountForPrincipal("guest-device-a"), null);
    assert.equal(await f.source.getVerificationResult({ tenantId: T, guestId: "guest-device-a" }), null);
    assert.deepEqual(await f.eligibility.evaluate(reservationFor("guest-device-a")), { eligible: false, reason: "no_account" });
  });
});

test("Hardening: a request whose principal belongs to a closed account is not claimed by a new account on the same email", async () => {
  await withFixture(async (f) => {
    const closed = f.signInDevice("guest-device-a", ADA);
    f.database.prepare("UPDATE guest_accounts SET status = 'closed' WHERE account_guest_id = ?").run([closed.account.accountGuestId]);
    // The request is made after the sign-in, so it has no claim row. Only the owner check can keep it from the new account.
    f.saveRequest({ requestId: "request-of-closed", primaryGuestId: "guest-device-a", contactEmail: ADA });
    // A new active account with the same address: the old principal link must not hand its request to this account.
    const fresh = f.signInDevice("guest-device-c", ADA);
    assert.notEqual(fresh.account.accountGuestId, closed.account.accountGuestId);
    assert.deepEqual(f.links.claimedRequestIds(fresh.account.accountGuestId, T), []);
    assert.equal(f.links.accountForPrincipal("guest-device-a"), null);
  });
});

// AC3 ---------------------------------------------------------------------------------------------------------------

test("AC3: changing the account email marks the outcome as needing re-verification", async () => {
  await withFixture(async (f) => {
    const session = f.signInDevice("guest-device-a", ADA);
    const accountGuestId = session.account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    f.changeAccountEmail(session, "ada.changed@example.test");
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, f.now())?.status, "verified", "the stale row remains stored but cannot pass the version guard");
    assert.equal((await f.source.getVerificationResult({ tenantId: T, guestId: "guest-device-a" }))?.governmentIdVerified, false);
    assert.deepEqual(await f.eligibility.evaluate(reservationFor("guest-device-a")), { eligible: false, reason: "not_verified" });
  });
});

test("AC3 failure path: signing in on another device with the same account keeps the current outcome", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    const second = f.signInDevice("guest-device-b", ADA);
    assert.equal(second.account.accountGuestId, accountGuestId);
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, f.now())?.status, "verified");
    assert.equal((await f.source.getVerificationResult({ tenantId: T, guestId: "guest-device-b" }))?.governmentIdVerified, true);
  });
});

test("AC3 failure path: a same-address change-email does not remove the outcome", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    // Writes that leave the normalized email unchanged advance account revision but not the email-specific version.
    f.database.prepare("UPDATE guest_accounts SET updated_at = ?, revision = revision + 1 WHERE account_guest_id = ?").run(["2026-10-10T10:00:00.000Z", accountGuestId]);
    f.database.prepare("UPDATE guest_accounts SET email_normalized = email_normalized WHERE account_guest_id = ?").run([accountGuestId]);
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, f.now())?.status, "verified");
  });
});

test("Slice 17 ADR 0094: both assurance consumers reject stored evidence when PLATFORM revision lookup is unavailable", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    const unavailable = { readAccountAssuranceState: async () => { throw new Error("platform unavailable"); } };
    const source = new AccountBackedGuestIdentityVerificationResultSource({ links: f.links, assurance: f.assurance, accountState: unavailable, clock: f.now });
    const eligibility = new GuestCheckInIdentityEligibility({ links: f.links, assurance: f.assurance, accountState: unavailable, clock: f.now });
    assert.equal((await source.getVerificationResult({ tenantId: T, guestId: "guest-device-a" }))?.governmentIdVerified, false);
    assert.deepEqual(await eligibility.evaluate(reservationFor("guest-device-a")), { eligible: false, reason: "not_verified" });
  });
});

test("Slice 17 reviewer P1: account status rejects old verified assurance after email revision changes even when cleanup is unavailable", async () => {
  await withFixture(async (f) => {
    const session = f.signInDevice("guest-device-a", ADA);
    f.assurance.recordOutcome(verifiedOutcome(session.account.accountGuestId));
    const runtime = new GuestAccountRuntime({
      database: f.database,
      tenantId: T,
      clock: f.now,
      requests: f.store,
      composition: { codeHashingKey: "r".repeat(32), sender: { send: async () => undefined } },
      assuranceInvalidator: { invalidateGuestIdentityAssurance: async () => { throw new Error("Shortlet unavailable"); } },
    });
    assert.equal((await runtime.accountStatus(session.account.accountGuestId))?.governmentIdVerified, true);
    f.changeAccountEmail(session, "ada.new@example.test");
    assert.equal(f.assurance.currentAssurance(session.account.accountGuestId, T, f.now())?.status, "verified", "cleanup outage leaves stale evidence stored");
    assert.equal((await runtime.accountStatus(session.account.accountGuestId))?.governmentIdVerified, false);
  });
});

test("Slice 17 reviewer P2: committed email change retries exact Shortlet cleanup after outage, while failed proof never invalidates", async () => {
  await withFixture(async (f) => {
    const session = f.signInDevice("guest-device-a", ADA);
    f.assurance.recordOutcome(verifiedOutcome(session.account.accountGuestId));
    const sent: string[] = [];
    let invalidateAttempts = 0;
    const runtime = new GuestAccountRuntime({
      database: f.database, tenantId: T, clock: f.now, requests: f.store,
      composition: { codeHashingKey: "p".repeat(32), sender: { send: async (message) => { sent.push(message.text); } } },
      assuranceInvalidator: { invalidateGuestIdentityAssurance: async ({ tenantId, accountGuestId }) => {
        assert.equal(tenantId, T);
        assert.equal(accountGuestId, session.account.accountGuestId);
        invalidateAttempts += 1;
        if (invalidateAttempts === 1) throw new Error("Shortlet unavailable");
        f.database.prepare("DELETE FROM guest_identity_assurance WHERE tenant_id = ? AND account_guest_id = ?").run([tenantId, accountGuestId]);
      } },
    });
    const credentials = { sessionId: session.sessionId, sessionSecret: session.sessionSecret };
    const challenge = await runtime.requestEmailChangeCode({ credentials, accountGuestId: session.account.accountGuestId, email: "ada.retry@example.test", clientAddress: "test-client" });
    const code = /\b(\d{6})\b/.exec(sent[0] ?? "")?.[1];
    assert.ok(code, "the delivery adapter receives a one-time code");
    await assert.rejects(runtime.confirmEmailChange({ credentials, accountGuestId: session.account.accountGuestId, challengeId: challenge.challengeId, email: challenge.email, code: "000000", clientAddress: "test-client" }));
    assert.equal(f.assurance.currentAssurance(session.account.accountGuestId, T, f.now())?.status, "verified", "rejected proof causes no cleanup");
    await assert.rejects(runtime.confirmEmailChange({ credentials, accountGuestId: session.account.accountGuestId, challengeId: challenge.challengeId, email: challenge.email, code, clientAddress: "test-client" }), /Shortlet unavailable/);
    assert.equal((await runtime.accountStatus(session.account.accountGuestId))?.account.email, challenge.email, "PLATFORM committed before remote cleanup failed");
    assert.equal((await runtime.accountStatus(session.account.accountGuestId))?.governmentIdVerified, false, "revision guard blocks trust during cleanup outage");
    await runtime.confirmEmailChange({ credentials, accountGuestId: session.account.accountGuestId, challengeId: challenge.challengeId, email: challenge.email, code, clientAddress: "test-client" });
    assert.equal(invalidateAttempts, 2, "replay retried the idempotent exact-account cleanup");
    assert.equal(f.assurance.currentAssurance(session.account.accountGuestId, T, f.now()), null);
    await assert.rejects(
      runtime.confirmEmailChange({ credentials, accountGuestId: session.account.accountGuestId, challengeId: challenge.challengeId, email: challenge.email, code, clientAddress: "test-client" }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "code_consumed",
    );
    assert.equal(invalidateAttempts, 2, "completed cleanup is not repeated on a consumed proof");
  });
});

// AC4 ---------------------------------------------------------------------------------------------------------------

test("AC4: check-in eligibility fails closed for a Reservation whose Primary Guest has no account", async () => {
  await withFixture(async (f) => {
    f.signInDevice("guest-device-a", ADA);
    f.assurance.recordOutcome(verifiedOutcome(f.links.accountForPrincipal("guest-device-a")!.accountGuestId));
    assert.deepEqual(await f.eligibility.evaluate(reservationFor("guest-anonymous-principal")), { eligible: false, reason: "no_account" });
  });
});

test("AC4: check-in eligibility fails closed for an expired outcome", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    assert.deepEqual(await f.eligibility.evaluate(reservationFor("guest-device-a")), { eligible: true });
    f.setNow(EXPIRES_AT);
    assert.deepEqual(await f.eligibility.evaluate(reservationFor("guest-device-a")), { eligible: false, reason: "expired" });
  });
});

test("AC4 failure path: pending, failed, provider-unavailable and email-only outcomes are not eligible", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    const notCurrent = [
      verifiedOutcome(accountGuestId, { status: "pending", verifiedAt: null, expiresAt: null }),
      verifiedOutcome(accountGuestId, { status: "failed", verifiedAt: null, expiresAt: null }),
      verifiedOutcome(accountGuestId, { status: "provider_unavailable", verifiedAt: null, expiresAt: null }),
      verifiedOutcome(accountGuestId, { level: "email-verified" }),
    ];
    for (const outcome of notCurrent) {
      f.assurance.recordOutcome(outcome);
      assert.deepEqual(await f.eligibility.evaluate(reservationFor("guest-device-a")), { eligible: false, reason: "not_verified" }, `${outcome.status} ${outcome.level}`);
    }
  });
});

test("AC4 failure path: a Reservation whose tenant differs from the account's tenant fails closed as no account", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    assert.deepEqual(await f.eligibility.evaluate(reservationFor("guest-device-a", "tenant-other")), { eligible: false, reason: "no_account" });
  });
});

test("AC4 failure path: a Reservation without a tenant, Reservation id or Primary Guest is refused", async () => {
  await withFixture(async (f) => {
    await assert.rejects(f.eligibility.evaluate(reservationFor("guest-device-a", "")), /required/);
    await assert.rejects(f.eligibility.evaluate(reservationFor("")), /required/);
    await assert.rejects(f.eligibility.evaluate({ reservationId: "", tenantId: T, primaryGuestId: "guest-device-a" }), /required/);
  });
});

// AC5 ---------------------------------------------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The check-in helper and the assurance store. Nothing may reach the helper; the store has the listed importers only. */
const GUARDED_HELPER = "guest-check-in-eligibility";
const GUARDED_STORE = "guest-identity-assurance";
const OPS_IMPORT = "apps/cloudflare/src/ops-import.ts";
const SCHEMA = "apps/cloudflare/src/schema.ts";
const CHECK_IN_HELPER = "domains/shortlet/src/guest-check-in-eligibility.ts";
/**
 * The local guest server is the gateway (review D1): the account runtime, and so the store, is reachable only through it. A traversal
 * stops at the gateway, and its direct importers are pinned below, so a booking or route module cannot reach the store around it.
 */
const COMPOSITION_ROOT = "apps/local-guest/src/guest-server.ts";
/** The only modules that compose the gateway: the pilot server and Worker, the local and pilot CLIs, and the preflight script. */
const GATEWAY_IMPORTERS = [
  "apps/cloudflare/src/shortlet-pilot-do.ts",
  "apps/local-guest/src/cli-start.ts",
  "apps/pilot/src/local-pilot-server.ts",
  "apps/pilot/src/pilot-server.ts",
  "scripts/assistant-preflight.ts",
].sort();
/**
 * Leaves: traversal stops at these, so the modules they import are not walked from an entry. Stopping is safe only because each leaf's
 * importers are pinned exactly below (review 1): a new importer of a leaf fails the guard, so it cannot reach the store unseen.
 */
const LEAF_FILES = [OPS_IMPORT, SCHEMA, COMPOSITION_ROOT];
/** Who may import each leaf, and why. Any other importer fails the guard. */
const LEAF_IMPORTERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // The ops HTTP routes use the import validator; the Node export script round-trips the daily export.
  [OPS_IMPORT]: ["apps/cloudflare/src/ops-routes.ts", "apps/cloudflare/src/platform-do.ts", "scripts/export-node-sqlite.ts"].sort(),
  // The ops routes check schema versions; each Durable Object applies its own migration stream; the Node script migrates restores.
  [SCHEMA]: ["apps/cloudflare/src/ops-routes.ts", "apps/cloudflare/src/platform-do.ts", "apps/cloudflare/src/shortlet-pilot-do.ts", "scripts/export-node-sqlite.ts"].sort(),
  [COMPOSITION_ROOT]: GATEWAY_IMPORTERS,
});
/**
 * Issue 07 account composition. The identity-status reader (read-only `currentAssurance`) is imported only by the account runtime, and
 * the runtime only by the gateway. Both may reach the store; no other module may (AC5).
 */
const STATUS_READER = "apps/local-guest/src/guest-identity-status.ts";
const ACCOUNT_RUNTIME = "apps/local-guest/src/guest-account-runtime.ts";
const ACCOUNT_PAGES = "apps/local-guest/src/guest-account-pages.ts";
const ACCOUNT_COMPOSITION = [ACCOUNT_RUNTIME, STATUS_READER];
/** The modules that import the store directly: the two migration manifests and the import validator, the check-in helper and the reader. */
const STORE_IMPORTERS = [OPS_IMPORT, SCHEMA, CHECK_IN_HELPER, STATUS_READER].sort();
/**
 * Every source root that can host a booking, route, application, payment or composition module, including the app scripts (review 4d).
 * Read from the filesystem, so a new app or package is swept without a list edit: `apps/*\/src`, `apps/*\/scripts`, `packages/*\/src`,
 * plus `domains` and `scripts`.
 */
function sourceRootsUnder(directory: string, child: string): string[] {
  return readdirSync(join(ROOT, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, directory, entry.name, child)))
    .map((entry) => `${directory}/${entry.name}/${child}`);
}
const SOURCE_ROOTS = ["domains", "scripts", ...sourceRootsUnder("apps", "src"), ...sourceRootsUnder("apps", "scripts"), ...sourceRootsUnder("packages", "src")];

/** Every module form the sweep reads: TypeScript, JavaScript and their module variants (review 4a). */
const MODULE_EXTENSION = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const moduleName = (file: string) => basename(file).replace(MODULE_EXTENSION, "");

/**
 * Every module specifier a file names: `import`/`export ... from`, bare `import "x"`, `import("x")`, `require("x")` and
 * `import x = require("x")` (review 4a, 4b). Relative specifiers only: the sweep is about the repository's own modules.
 */
const SPECIFIER_PATTERNS = [
  /\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g,
  /(?<![\w$.])require\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
];
export function relativeSpecifiers(text: string): string[] {
  return SPECIFIER_PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]!));
}

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    // Review 4e: a `test` directory is walked like any other, so a non-test module cannot hide in it. Only `.test.` files are skipped.
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (MODULE_EXTENSION.test(entry.name) && !entry.name.endsWith(".d.ts") && !entry.name.includes(".test.")) out.push(path);
  }
  return out;
}

const ALL_SOURCE = SOURCE_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)));
const importCache = new Map<string, string[]>();

/**
 * A relative specifier resolved to the module file it names. A directory-style import resolves to its index module (review 4), so it is
 * never read as a file. A specifier that names nothing resolves to a path that does not exist and is skipped by the caller.
 */
function resolveSpecifier(file: string, specifier: string): string {
  // A query (for example Vite's `?raw` asset import) names an asset, not a module: the path before it is what is resolved.
  const base = resolve(dirname(file), specifier.split("?")[0]!);
  const withoutJs = base.endsWith(".js") ? base.slice(0, -3) : base;
  const candidates = base.endsWith(".js")
    ? [`${withoutJs}.ts`, base, `${withoutJs}.mjs`, `${withoutJs}.cjs`, join(withoutJs, "index.ts"), join(withoutJs, "index.js")]
    : [base, `${base}.ts`, `${base}.mjs`, `${base}.cjs`, `${base}.js`, join(base, "index.ts"), join(base, "index.js")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? base;
}

/** The repository modules a file imports, resolved to the files they name. Only module files are read; an asset target is a leaf. */
function importsOf(file: string): string[] {
  const cached = importCache.get(file);
  if (cached) return cached;
  if (!MODULE_EXTENSION.test(file) || !existsSync(file)) return [];
  const resolved = relativeSpecifiers(readFileSync(file, "utf8")).map((specifier) => resolveSpecifier(file, specifier));
  importCache.set(file, resolved);
  return resolved;
}

const rel = (file: string) => relative(ROOT, file).split(sep).join("/");
const isGuarded = (file: string) => [GUARDED_HELPER, GUARDED_STORE].includes(moduleName(file));
const importersOf = (base: string) => ALL_SOURCE.filter((file) => importsOf(file).some((target) => moduleName(target) === base)).map(rel).sort();

test("AC5: no booking, route, application or payment module reaches the eligibility helper or the assurance store, through barrels or direct imports", () => {
  const leaves = new Set(LEAF_FILES.map((file) => join(ROOT, file)));
  const composition = new Set(ACCOUNT_COMPOSITION.map((file) => join(ROOT, file)));
  // The account runtime and reader are reached only through the gateway (pinned below), so they are not entries themselves.
  const entries = ALL_SOURCE.filter((file) => !isGuarded(file) && !leaves.has(file) && !composition.has(file));
  assert.ok(entries.length > 100, "the sweep covers every source root");
  const violations: string[] = [];
  for (const entry of entries) {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (isGuarded(file)) violations.push(`${rel(entry)} reaches ${rel(file)}`);
      if (file !== entry && leaves.has(file)) continue;
      queue.push(...importsOf(file));
    }
  }
  assert.deepEqual(violations, []);
});

test("AC5 (review 1): each leaf is imported by exactly the pinned modules, so no route or booking module can reach the store through a leaf", () => {
  for (const leaf of LEAF_FILES) {
    assert.deepEqual(importersOf(moduleName(leaf)), [...LEAF_IMPORTERS[leaf]!].sort(), `the importers of ${leaf}`);
  }
});

test("AC5: only the schema manifest, the import validator, the check-in helper and the status reader import the assurance store, and nothing imports the eligibility helper", () => {
  assert.deepEqual(importersOf(GUARDED_STORE), STORE_IMPORTERS);
  assert.deepEqual(importersOf(GUARDED_HELPER), []);
});

test("AC5 (issue 07, review D1): only the five composition entrypoints import the gateway, only the gateway imports the account runtime, and only the runtime imports the identity-status reader", () => {
  assert.deepEqual(importersOf(moduleName(COMPOSITION_ROOT)), GATEWAY_IMPORTERS);
  assert.deepEqual(importersOf(moduleName(ACCOUNT_RUNTIME)), [COMPOSITION_ROOT]);
  assert.deepEqual(importersOf(moduleName(STATUS_READER)), [ACCOUNT_RUNTIME]);
});

test("AC5 (issue 07): the account pages import neither the store nor the eligibility helper", () => {
  const pageTargets = importsOf(join(ROOT, ACCOUNT_PAGES)).map(moduleName);
  assert.ok(!pageTargets.includes(GUARDED_STORE) && !pageTargets.includes(GUARDED_HELPER), "the account pages import no assurance module");
});

test("AC5: no non-test source imports this issue's test-only fixtures", () => {
  // Scoped to the issue 09 fixtures. Other test helpers are used by existing smoke scripts and are not in scope here.
  const testOnly = new Set([
    join(ROOT, "test", "helpers", "identity-assurance-fixture.ts"),
    join(ROOT, "test", "helpers", "guest-identity-assurance.ts"),
  ]);
  const violations = ALL_SOURCE.flatMap((file) => importsOf(file)
    .filter((target) => testOnly.has(target))
    .map((target) => `${rel(file)} imports ${rel(target)}`));
  assert.deepEqual(violations, []);
});

test("AC5 (review 4a, 4b): require() and import x = require() are module edges the sweep reads", () => {
  assert.deepEqual(relativeSpecifiers('const x = require("./a.js");'), ["./a.js"]);
  assert.deepEqual(relativeSpecifiers('import b = require("../b.js");'), ["../b.js"]);
  assert.deepEqual(relativeSpecifiers('const c = await import("./c.js"); export * from "./d.js";'), ["./c.js", "./d.js"]);
  assert.deepEqual(relativeSpecifiers('const r = createRequire(import.meta.url); r.resolve("./e.js");'), [], "a method named require on another object is not a module edge");
});

test("AC5 (review 4c): no source module imports through a non-literal import() or require() that the sweep cannot resolve", () => {
  // Minimal allowlist, empty on purpose: a dynamic import must name its module with a string literal (review 4c).
  const DYNAMIC_ALLOWLIST: readonly string[] = [];
  const dynamic = /(?<![\w$.])(?:import|require)\s*\(\s*(?!["'])/;
  // Comments are removed first, so prose such as "import (runbook R5)" is not a call. A `//` inside a string literal can hide a
  // call on the same line; that is accepted for this detection guard and noted in the test.
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const violations = ALL_SOURCE.filter((file) => !DYNAMIC_ALLOWLIST.includes(rel(file)) && dynamic.test(code(readFileSync(file, "utf8"))))
    .map(rel);
  assert.deepEqual(violations, []);
});

test("AC5: every discovered source root contributes at least one module to the sweep", () => {
  // The roots are read from the filesystem, so a new app or package is swept without a list edit.
  assert.ok(SOURCE_ROOTS.includes("apps/web-agent/src"));
  for (const root of SOURCE_ROOTS) {
    assert.ok(ALL_SOURCE.some((file) => file.startsWith(join(ROOT, root) + sep)), `${root} contributes a module`);
  }
});

test("AC5 (review 4d): the apps' scripts directories are swept as source roots", () => {
  assert.ok(SOURCE_ROOTS.some((root) => root.startsWith("apps/") && root.endsWith("/scripts")), "an app scripts directory is a source root");
});

test("AC5 (review 4e): no non-test module hides in a test-named directory or file under a source root", () => {
  // `.test.` files are skipped as tests. A module in a `test` directory is walked like any other, so it is an entry and is checked.
  const testDirectoryModules = ALL_SOURCE.filter((file) => /(^|\/)test\//.test(rel(file)) && !/\.test\./.test(rel(file)));
  for (const file of testDirectoryModules) {
    assert.ok(importsOf(file).every((target) => !moduleName(target).startsWith(GUARDED_STORE)), `${rel(file)} must not reach the store`);
  }
});

test("AC5: the sweep reads JavaScript modules as well as TypeScript", () => {
  assert.ok(ALL_SOURCE.some((file) => file.endsWith(".mjs")), "at least one .mjs module is swept");
});

// AC6 ---------------------------------------------------------------------------------------------------------------

test("AC6: the stored record holds only the ADR 0094 fields", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { method: NIN_V2_METHOD, providerReference: "opaque-ref-1" }));
    const columns = f.database.prepare("PRAGMA table_info(guest_identity_assurance)").all().map((row) => String(row.name)).sort();
      assert.deepEqual(columns, ["account_email_revision", "account_guest_id", "expires_at", "level", "method", "provider_reference", "status", "tenant_id", "verified_at"]);
    assert.equal(f.database.prepare("SELECT * FROM guest_identity_assurance").get()?.provider_reference, "opaque-ref-1");
  });
});

test("AC6 failure path: identity evidence passed alongside an outcome is never stored", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    // Not an object literal, so excess-property checks do not apply: the store must still drop the evidence.
    const withEvidence = {
      ...verifiedOutcome(accountGuestId),
      nin: "12345678901",
      bvn: "22233344455",
      rawPayload: { selfie: "base64-image-bytes" },
    };
    f.assurance.recordOutcome(withEvidence);
    const everything = JSON.stringify(f.database.prepare("SELECT * FROM guest_identity_assurance").all());
    assert.equal(everything.includes("12345678901"), false);
    assert.equal(everything.includes("22233344455"), false);
    assert.equal(everything.includes("base64-image-bytes"), false);
  });
});

test("AC6 failure path: a level or status outside ADR 0094 and ADR 0084 is refused", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    // The app-level messages are matched, not the SQL CHECK text, so each guard is probed on its own.
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { level: "nin-verified" as never })), /level must be one of the ADR 0094 levels/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { status: "not_started" as never })), /status must be one of the ADR 0084 recorded states/);
    assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
  });
});

test("AC6: the provider reference limits are store options with named defaults, and an override changes what is accepted", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    const production = new SqliteGuestIdentityAssurance(f.database, { clock: () => f.now() });
    const accepted = (store: SqliteGuestIdentityAssurance, providerReference: string) => {
      store.recordOutcome(verifiedOutcome(accountGuestId, { providerReference }));
      return store.currentAssurance(accountGuestId, T, f.now())?.providerReference === providerReference;
    };
    // Defaults (64 characters, runs of 9 digits): a store without options uses the named defaults.
    assert.equal(accepted(production, "a".repeat(64)), true);
    assert.throws(() => production.recordOutcome(verifiedOutcome(accountGuestId, { providerReference: "a".repeat(65) })), /providerReference/);
    assert.equal(accepted(production, "ref-12345678"), true);
    assert.throws(() => production.recordOutcome(verifiedOutcome(accountGuestId, { providerReference: "ref-123456789" })), /providerReference/);
    // Overrides: an 8-character limit and a 4-digit run.
    const strict = new SqliteGuestIdentityAssurance(f.database, { clock: () => f.now(), maxProviderReferenceLength: 8, restrictedDigitRunLength: 4 });
    assert.equal(accepted(strict, "abc-12"), true);
    assert.throws(() => strict.recordOutcome(verifiedOutcome(accountGuestId, { providerReference: "abcdefghi" })), /providerReference/);
    assert.throws(() => strict.recordOutcome(verifiedOutcome(accountGuestId, { providerReference: "ab-12345" })), /providerReference/);
    // Invalid options fail at construction, not later.
    assert.throws(() => new SqliteGuestIdentityAssurance(f.database, { clock: () => f.now(), maxProviderReferenceLength: 0 }), /positive integer/);
    assert.throws(() => new SqliteGuestIdentityAssurance(f.database, { clock: () => f.now(), restrictedDigitRunLength: 1.5 }), /positive integer/);
  });
});

test("AC6: the ops import path applies the same reference limits, and its default is the one the store uses", () => {
  const database = openNodeSqliteDatabase(":memory:");
  try {
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, "2026-10-10T00:00:00.000Z");
    const row = { tenant_id: T, account_guest_id: "gacct-policy", account_email_revision: 0, level: "government-ID-verified", method: NIN_V2_METHOD, status: "verified", verified_at: VERIFIED_AT, expires_at: EXPIRES_AT, provider_reference: "abc-12345" };
    const now = new Date(VERIFIED_AT);
    // The default screen (runs of 9 digits) accepts a 5-digit run; a 4-digit override refuses it.
    assert.equal(identityAssuranceRowForImport(database, row, now)["provider_reference"], "abc-12345");
    assert.throws(() => identityAssuranceRowForImport(database, row, now, { maxProviderReferenceLength: 64, restrictedDigitRunLength: 4 }), /providerReference/);
  } finally {
    database.close();
  }
});

test("AC6: the provider reference limits in use are the named defaults, and the domain module keeps no hardcoded copy of them", () => {
  assert.equal(DEFAULT_IDENTITY_ASSURANCE_REFERENCE_POLICY.maxProviderReferenceLength, 64);
  assert.equal(DEFAULT_IDENTITY_ASSURANCE_REFERENCE_POLICY.restrictedDigitRunLength, 9);
  const source = readFileSync(join(ROOT, "domains/shortlet/src/guest-identity-assurance.ts"), "utf8");
  assert.equal(source.includes("{0,63}"), false, "no literal 64-character pattern");
  assert.equal(source.includes("\\d{9,}"), false, "no literal 9-digit pattern");
});

test("AC6: the ADR 0084 method and an opaque provider reference are accepted", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { method: NIN_V2_METHOD, providerReference: "smile-job-7f3a9c2b" }));
    const current = f.assurance.currentAssurance(accountGuestId, T, f.now());
    assert.equal(current?.method, NIN_V2_METHOD);
    assert.equal(current?.providerReference, "smile-job-7f3a9c2b");
  });
});

test("AC6 failure path: a method that is not a platform-owned identifier is refused, and the test fixture method is refused by the production store", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    const production = new SqliteGuestIdentityAssurance(f.database, { clock: () => f.now() });
    for (const method of ["12345678901", "", "nigeria-nin-v2", "local-fixture"]) {
      assert.throws(() => production.recordOutcome(verifiedOutcome(accountGuestId, { method })), /method must be a platform-owned identifier/, method);
    }
    assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
    // Control: the fixture store, which only test helpers construct, accepts its own fixture method.
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { method: "local-fixture" }));
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, f.now())?.method, "local-fixture");
  });
});

test("AC6 failure path: a provider reference that looks like a restricted identifier is refused", async () => {
  await withFixture(async (f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    const refused = [
      "22233344455", "job-12345678901", "ref 1234", "ref-123456789", "x".repeat(65), "", "-leading-dash",
      // A digit run hidden behind separators is still a digit run (separators are stripped before the screen).
      "a1234-5678-901", "a1234_5678_901", "a0801-234-5678", "a222-2222-222", "a1234567-8901",
    ];
    for (const providerReference of refused) {
      assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { providerReference })), /providerReference/, providerReference);
    }
    // Controls: an 8-digit run inside an opaque reference is still accepted, and so is a reference with a few digits.
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { providerReference: "ref-12345678" }));
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, f.now())?.providerReference, "ref-12345678");
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { providerReference: "a1-b2-c3-d4_e5" }));
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, f.now())?.providerReference, "a1-b2-c3-d4_e5");
  });
});

test("AC6 failure path: an ops import cannot write a current verified row without the same validation", () => {
  const database = openNodeSqliteDatabase(":memory:");
  try {
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, "2026-10-10T00:00:00.000Z");
    const row = {
      tenant_id: T, account_guest_id: "gacct-import-1", account_email_revision: 0, level: "government-ID-verified", method: NIN_V2_METHOD,
      status: "verified", verified_at: VERIFIED_AT, expires_at: EXPIRES_AT, provider_reference: null,
    };
    const now = new Date(VERIFIED_AT);
    const refused = (candidate: Record<string, unknown>) => assert.throws(
      () => importBatch(database, "guest_identity_assurance", [candidate], SHORTLET_SCHEMA_VERSION, now),
      (error: unknown) => error instanceof Error && error.message.includes("failed validation"),
    );
    refused({ ...row, method: "12345678901" });
    refused({ ...row, verified_at: "2026-10-10T09:00:00.001Z" });
    const { account_email_revision: _version, ...legacy } = row;
    refused(legacy);
    refused({ ...row, expires_at: null });
    refused({ ...row, provider_reference: "22233344455" });
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
    // Control: a row that passes the same rules is imported (restore from the daily export keeps working).
    importBatch(database, "guest_identity_assurance", [row], SHORTLET_SCHEMA_VERSION, now);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 1);
  } finally {
    database.close();
  }
});

test("AC6: an ops import restores an identity assurance row for an active account and for a closed account of the same tenant", () => {
  const database = openNodeSqliteDatabase(":memory:");
  try {
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, "2026-10-10T00:00:00.000Z");
    const rowFor = (accountGuestId: string) => ({
      tenant_id: T, account_guest_id: accountGuestId, account_email_revision: 0, level: "government-ID-verified", method: NIN_V2_METHOD,
      status: "verified", verified_at: VERIFIED_AT, expires_at: EXPIRES_AT, provider_reference: null,
    });
    // A daily export written while the account was active restores after the account has since closed.
    importBatch(database, "guest_identity_assurance", [rowFor("gacct-active"), rowFor("gacct-closed")], SHORTLET_SCHEMA_VERSION, new Date(VERIFIED_AT));
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 2);
  } finally {
    database.close();
  }
});

test("Slice 17 ADR 0094: assurance import rejects legacy rows whose historical email revision cannot be proven", () => {
  const database = openNodeSqliteDatabase(":memory:");
  try {
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, "2026-10-10T00:00:00.000Z");
    const base = { tenant_id: T, level: "government-ID-verified", method: NIN_V2_METHOD, status: "verified", verified_at: VERIFIED_AT, expires_at: EXPIRES_AT, provider_reference: null };
    const now = new Date(VERIFIED_AT);
    assert.throws(() => importBatch(database, "guest_identity_assurance", [{ ...base, account_guest_id: "gacct-legacy" }], SHORTLET_SCHEMA_VERSION, now),
      (error: unknown) => error instanceof Error && error.message === "An identity assurance row failed validation, so nothing from the batch was written");
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
  } finally {
    database.close();
  }
});

test("AC6 failure path: an ops import refuses a provider reference that hides a restricted digit run behind separators", () => {
  const database = openNodeSqliteDatabase(":memory:");
  try {
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, "2026-10-10T00:00:00.000Z");
    const row = { tenant_id: T, account_guest_id: "gacct-import-2", account_email_revision: 0, level: "government-ID-verified", method: NIN_V2_METHOD, status: "verified", verified_at: VERIFIED_AT, expires_at: EXPIRES_AT };
    for (const provider_reference of ["a1234-5678-901", "a1234_5678_901", "a0801-234-5678", "a222-2222-222", "a1234567-8901"]) {
      assert.throws(
        () => importBatch(database, "guest_identity_assurance", [{ ...row, provider_reference }], SHORTLET_SCHEMA_VERSION, new Date(VERIFIED_AT)),
        /failed validation/,
        provider_reference,
      );
    }
    importBatch(database, "guest_identity_assurance", [{ ...row, provider_reference: "a1-b2-c3" }], SHORTLET_SCHEMA_VERSION, new Date(VERIFIED_AT));
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 1);
  } finally {
    database.close();
  }
});

test("Hardening: an invalid injected clock refuses recording and import rather than failing open", () => {
  const database = openNodeSqliteDatabase(":memory:");
  try {
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, "2026-10-10T00:00:00.000Z");
    const invalid = new Date("not-a-date");
    const store = new SqliteGuestIdentityAssurance(database, { clock: () => invalid });
    assert.throws(() => store.recordOutcome(verifiedOutcome("gacct-clock")), /valid clock/);
    const row = { tenant_id: T, account_guest_id: "gacct-clock", account_email_revision: 0, level: "government-ID-verified", method: NIN_V2_METHOD, status: "verified", verified_at: VERIFIED_AT, expires_at: EXPIRES_AT, provider_reference: null };
    assert.throws(() => importBatch(database, "guest_identity_assurance", [row], SHORTLET_SCHEMA_VERSION, invalid), /failed validation/);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
  } finally {
    database.close();
  }
});

test("AC5: every discovered source root contributes at least one module to the sweep", () => {
  // The roots are read from the filesystem, so a new app or package is swept without a list edit.
  assert.ok(SOURCE_ROOTS.includes("apps/web-agent/src"));
  for (const root of SOURCE_ROOTS) {
    assert.ok(ALL_SOURCE.some((file) => rel(file).startsWith(`${root}/`)), `${root} contributes a module`);
  }
});

test("AC5: the sweep reads JavaScript modules as well as TypeScript", () => {
  assert.ok(ALL_SOURCE.some((file) => file.endsWith(".mjs")), "at least one .mjs module is swept");
});

// Schema ------------------------------------------------------------------------------------------------------------

test("Slice 17 ADR 0094: assurance remains in shortlet without a platform-account foreign key or cross-database trigger", () => {
  assert.equal(SHORTLET_SCHEMA_VERSION, 4);
  const database = openNodeSqliteDatabase(":memory:");
  try {
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS.slice(0, 3), "2026-10-10T00:00:00.000Z");
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, "2026-10-10T00:00:00.000Z");
    const objects = database.prepare("SELECT name, type FROM sqlite_master").all().map((row) => `${row.type}:${row.name}`);
    assert.ok(objects.includes("table:guest_identity_assurance"));
    assert.ok(!objects.includes("trigger:guest_identity_assurance_on_email_change"));
    const foreignKeys = database.prepare("PRAGMA foreign_key_list(guest_identity_assurance)").all();
    assert.ok(!foreignKeys.some((row) => row.table === "guest_accounts"));
  } finally {
    database.close();
  }
});
