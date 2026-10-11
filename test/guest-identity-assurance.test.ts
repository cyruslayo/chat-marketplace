import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../apps/cloudflare/src/schema.js";
import { applySchemaMigrations } from "../packages/platform-core/src/schema-migrations.js";
import { recordLocalVerifiedIdentity } from "../apps/local-guest/src/identity-assurance-fixture.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
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

async function withFixture(run: (fixture: GuestIdentityAssuranceFixture) => void): Promise<void> {
  const fixture = await createGuestIdentityAssuranceFixture();
  try {
    run(fixture);
  } finally {
    await fixture.close();
  }
}

// AC1 ---------------------------------------------------------------------------------------------------------------

test("AC1: a recorded verified outcome is returned for the account from any linked principal", async () => {
  await withFixture((f) => {
    const session = f.signInDevice("guest-device-a", ADA);
    f.signInDevice("guest-device-b", ADA);
    const accountGuestId = session.account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, f.now())?.status, "verified");
    for (const guestId of ["guest-device-a", "guest-device-b"]) {
      assert.deepEqual(f.source.getVerificationResult({ tenantId: T, guestId }), { tenantId: T, guestId, governmentIdVerified: true });
    }
  });
});

test("AC1 failure path: a principal not linked to the account gets null", async () => {
  await withFixture((f) => {
    f.signInDevice("guest-device-a", ADA);
    const session = f.signInDevice("guest-other-account", GRACE);
    f.assurance.recordOutcome(verifiedOutcome(f.links.accountForPrincipal("guest-device-a")!.accountGuestId));
    assert.equal(f.source.getVerificationResult({ tenantId: T, guestId: "guest-never-signed-in" }), null);
    // A principal linked to a different account reads that account's (empty) assurance, never the verified one.
    assert.equal(f.source.getVerificationResult({ tenantId: T, guestId: "guest-other-account" })?.governmentIdVerified, false);
    assert.equal(f.assurance.currentAssurance(session.account.accountGuestId, T, f.now()), null);
  });
});

test("AC1 failure path: a principal read under another tenant gets null", async () => {
  await withFixture((f) => {
    const session = f.signInDevice("guest-device-a", ADA);
    f.assurance.recordOutcome(verifiedOutcome(session.account.accountGuestId));
    assert.equal(f.source.getVerificationResult({ tenantId: "tenant-other", guestId: "guest-device-a" }), null);
    assert.equal(f.source.getVerificationResult({ tenantId: "", guestId: "guest-device-a" }), null);
    assert.equal(f.assurance.currentAssurance(session.account.accountGuestId, "tenant-other", f.now()), null);
  });
});

test("AC1 failure path: an outcome for an account that is not an active account of this tenant is refused", async () => {
  await withFixture((f) => {
    const session = f.signInDevice("guest-device-a", ADA);
    const accountGuestId = session.account.accountGuestId;
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { tenantId: "tenant-other" })), /active Guest Account/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome("gacct-does-not-exist")), /active Guest Account/);
    assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
  });
});

test("AC1: the local fake records a verified outcome that the account-backed source returns", async () => {
  await withFixture((f) => {
    const session = f.signInDevice("guest-device-a", ADA);
    recordLocalVerifiedIdentity(f.assurance, { tenantId: T, accountGuestId: session.account.accountGuestId, verifiedAt: VERIFIED_AT, expiresAt: EXPIRES_AT });
    assert.equal(f.source.getVerificationResult({ tenantId: T, guestId: "guest-device-a" })?.governmentIdVerified, true);
  });
});

// AC2 ---------------------------------------------------------------------------------------------------------------

test("AC2: an outcome whose explicit expiresAt has passed reads as expired at the next call without any background job", async () => {
  await withFixture((f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, new Date(Date.parse(EXPIRES_AT) - 1))?.status, "verified");
    // At the explicit expiry instant the result is expired (ADR 0094: now < expiresAt is required).
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, new Date(EXPIRES_AT))?.status, "expired");
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, new Date("2030-01-01T00:00:00.000Z"))?.status, "expired");
    // Lazy: nothing was rewritten by the reads, so the stored status is still the recorded verified outcome.
    assert.equal(f.database.prepare("SELECT status FROM guest_identity_assurance WHERE account_guest_id = ?").get([accountGuestId])?.status, "verified");
    f.setNow(EXPIRES_AT);
    assert.equal(f.source.getVerificationResult({ tenantId: T, guestId: "guest-device-a" })?.governmentIdVerified, false);
  });
});

test("AC2 failure path: a verified outcome without an explicit expiresAt is refused, so no default expiry applies", async () => {
  await withFixture((f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    for (const expiresAt of [undefined, null, ""]) {
      assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { expiresAt })), /expiresAt/);
    }
    assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
  });
});

test("AC2 failure path: a stored verified result with no explicit expiry never reads as current", async () => {
  await withFixture((f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    // A row written around the store's validation (for example by a bad import) must not be read as current assurance.
    f.database.prepare(`INSERT INTO guest_identity_assurance (tenant_id, account_guest_id, level, method, status, verified_at, expires_at, provider_reference)
      VALUES (?, ?, 'government-ID-verified', 'local-fixture', 'verified', ?, NULL, NULL)`).run([T, accountGuestId, VERIFIED_AT]);
    assert.throws(() => f.assurance.currentAssurance(accountGuestId, T, f.now()), /malformed/);
    assert.throws(() => f.eligibility.evaluate(reservationFor("guest-device-a")), /malformed/);
  });
});

test("AC2 failure path: a verified outcome with an invalid verifiedAt, or an expiry not later than verification, is refused", async () => {
  await withFixture((f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { verifiedAt: null })), /verifiedAt/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { verifiedAt: "not-a-timestamp" })), /verifiedAt/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { expiresAt: "not-a-timestamp" })), /expiresAt/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { expiresAt: VERIFIED_AT })), /expiresAt/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { expiresAt: "2026-10-09T09:00:00.000Z" })), /expiresAt/);
    assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
  });
});

// AC3 ---------------------------------------------------------------------------------------------------------------

test("AC3: changing the account email marks the outcome as needing re-verification", async () => {
  await withFixture((f) => {
    const session = f.signInDevice("guest-device-a", ADA);
    const accountGuestId = session.account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    f.changeAccountEmail(session, "ada.changed@example.test");
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, f.now()), null);
    assert.equal(f.source.getVerificationResult({ tenantId: T, guestId: "guest-device-a" })?.governmentIdVerified, false);
    assert.deepEqual(f.eligibility.evaluate(reservationFor("guest-device-a")), { eligible: false, reason: "not_verified" });
  });
});

test("AC3 failure path: signing in on another device with the same account keeps the current outcome", async () => {
  await withFixture((f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    const second = f.signInDevice("guest-device-b", ADA);
    assert.equal(second.account.accountGuestId, accountGuestId);
    assert.equal(f.assurance.currentAssurance(accountGuestId, T, f.now())?.status, "verified");
    assert.equal(f.source.getVerificationResult({ tenantId: T, guestId: "guest-device-b" })?.governmentIdVerified, true);
  });
});

// AC4 ---------------------------------------------------------------------------------------------------------------

test("AC4: check-in eligibility fails closed for a Reservation whose Primary Guest has no account", async () => {
  await withFixture((f) => {
    f.signInDevice("guest-device-a", ADA);
    f.assurance.recordOutcome(verifiedOutcome(f.links.accountForPrincipal("guest-device-a")!.accountGuestId));
    assert.deepEqual(f.eligibility.evaluate(reservationFor("guest-anonymous-principal")), { eligible: false, reason: "no_account" });
  });
});

test("AC4: check-in eligibility fails closed for an expired outcome", async () => {
  await withFixture((f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    assert.deepEqual(f.eligibility.evaluate(reservationFor("guest-device-a")), { eligible: true });
    f.setNow(EXPIRES_AT);
    assert.deepEqual(f.eligibility.evaluate(reservationFor("guest-device-a")), { eligible: false, reason: "expired" });
  });
});

test("AC4 failure path: pending, failed, provider-unavailable and email-only outcomes are not eligible", async () => {
  await withFixture((f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    const notCurrent = [
      verifiedOutcome(accountGuestId, { status: "pending", verifiedAt: null, expiresAt: null }),
      verifiedOutcome(accountGuestId, { status: "failed", verifiedAt: null, expiresAt: null }),
      verifiedOutcome(accountGuestId, { status: "provider_unavailable", verifiedAt: null, expiresAt: null }),
      verifiedOutcome(accountGuestId, { level: "email-verified" }),
    ];
    for (const outcome of notCurrent) {
      f.assurance.recordOutcome(outcome);
      assert.deepEqual(f.eligibility.evaluate(reservationFor("guest-device-a")), { eligible: false, reason: "not_verified" }, `${outcome.status} ${outcome.level}`);
    }
  });
});

test("AC4 failure path: a Reservation whose tenant differs from the account's tenant fails closed as no account", async () => {
  await withFixture((f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId));
    assert.deepEqual(f.eligibility.evaluate(reservationFor("guest-device-a", "tenant-other")), { eligible: false, reason: "no_account" });
  });
});

test("AC4 failure path: a Reservation without a tenant, Reservation id or Primary Guest is refused", async () => {
  await withFixture((f) => {
    assert.throws(() => f.eligibility.evaluate(reservationFor("guest-device-a", "")), /required/);
    assert.throws(() => f.eligibility.evaluate(reservationFor("")), /required/);
    assert.throws(() => f.eligibility.evaluate({ reservationId: "", tenantId: T, primaryGuestId: "guest-device-a" }), /required/);
  });
});

// AC5 ---------------------------------------------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The two modules that hold the assurance store and the check-in helper. Only the listed files may import them. */
const GUARDED_MODULES = ["guest-identity-assurance", "guest-check-in-eligibility"];
/** The discovery, request, offer and payment modules (ADR 0085: booking never reads identity assurance). */
const BOOKING_ENTRY_MODULES = [
  "browse", "listing-details", "ranking", "availability", "quote", "booking-request", "conditional-offer",
  "booking-payment-journey", "card-payment", "bank-transfer", "manual-transfer", "payment-attempt", "paystack",
].map((name) => join(ROOT, "domains", "shortlet", "src", `${name}.ts`));

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "test") continue;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !entry.name.includes(".test.")) out.push(path);
  }
  return out;
}

/** Relative imports of a TypeScript module, resolved to the `.ts` file they name. */
function relativeImportsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  // Covers `from "x"`, `export * from "x"`, `import("x")` and bare side-effect `import "x"`.
  const specifiers = [...text.matchAll(/\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map((match) => match[1]!);
  return specifiers.map((specifier) => resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
}

test("AC5: no discovery, request, offer or payment code path imports the eligibility helper or the assurance store", () => {
  for (const entry of BOOKING_ENTRY_MODULES) assert.ok(existsSync(entry), `booking module ${relative(ROOT, entry)} exists`);
  // Transitive closure from the booking modules over relative imports.
  const seen = new Set<string>();
  const queue = [...BOOKING_ENTRY_MODULES];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (existsSync(file)) queue.push(...relativeImportsOf(file));
  }
  assert.ok(seen.size > BOOKING_ENTRY_MODULES.length, "the closure follows the booking modules' imports");
  const reached = [...seen].filter((file) => GUARDED_MODULES.includes(basename(file, ".ts")));
  assert.deepEqual(reached.map((file) => relative(ROOT, file)), []);
});

test("AC5: only the assurance module, the check-in helper, the barrel, the schema and the local fake import the guarded modules", () => {
  const roots = ["domains", "apps", "packages", "scripts"].map((name) => join(ROOT, name));
  const importers = roots
    .flatMap((root) => sourceFiles(root))
    .filter((file) => relativeImportsOf(file).some((target) => GUARDED_MODULES.includes(basename(target, ".ts"))))
    .map((file) => relative(ROOT, file).split(sep).join("/"))
    .sort();
  assert.deepEqual(importers, [
    "apps/cloudflare/src/schema.ts",
    "apps/local-guest/src/identity-assurance-fixture.ts",
    "domains/shortlet/src/guest-check-in-eligibility.ts",
    "domains/shortlet/src/index.ts",
  ]);
});

// AC6 ---------------------------------------------------------------------------------------------------------------

test("AC6: the stored record holds only the ADR 0094 fields", async () => {
  await withFixture((f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { providerReference: "opaque-ref-1" }));
    const columns = f.database.prepare("PRAGMA table_info(guest_identity_assurance)").all().map((row) => String(row.name)).sort();
    assert.deepEqual(columns, ["account_guest_id", "expires_at", "level", "method", "provider_reference", "status", "tenant_id", "verified_at"]);
    const row = f.database.prepare("SELECT * FROM guest_identity_assurance").get();
    assert.equal(row?.provider_reference, "opaque-ref-1");
  });
});

test("AC6 failure path: identity evidence passed alongside an outcome is never stored", async () => {
  await withFixture((f) => {
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
  await withFixture((f) => {
    const accountGuestId = f.signInDevice("guest-device-a", ADA).account.accountGuestId;
    // The app-level messages are matched, not the SQL CHECK text, so each guard is probed on its own.
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { level: "nin-verified" as never })), /level must be one of the ADR 0094 levels/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { status: "not_started" as never })), /status must be one of the ADR 0084 recorded states/);
    assert.throws(() => f.assurance.recordOutcome(verifiedOutcome(accountGuestId, { method: "" })), /method/);
    assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM guest_identity_assurance").get()?.n, 0);
  });
});

// Schema ------------------------------------------------------------------------------------------------------------

test("Schema: migration 4 creates the assurance table and the email-change trigger on a database at migration 3", () => {
  assert.equal(SHORTLET_SCHEMA_VERSION, 4);
  const database = openNodeSqliteDatabase(":memory:");
  try {
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS.slice(0, 3), "2026-10-10T00:00:00.000Z");
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, "2026-10-10T00:00:00.000Z");
    const objects = database.prepare("SELECT name, type FROM sqlite_master").all().map((row) => `${row.type}:${row.name}`);
    assert.ok(objects.includes("table:guest_identity_assurance"));
    assert.ok(objects.includes("trigger:guest_identity_assurance_on_email_change"));
  } finally {
    database.close();
  }
});
