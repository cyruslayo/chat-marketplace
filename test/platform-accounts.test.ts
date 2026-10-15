import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { createPlatformAccounts } from "../packages/platform-core/src/accounts/accounts.js";
import { signInGuestAccount, TEST_GUEST_CODE_HASHING_KEY } from "./helpers/guest-account-authority.js";
import { ASSURANCE_TENANT, createGuestIdentityAssuranceFixture, verifiedOutcome } from "./helpers/guest-identity-assurance.js";

// Map slice 16: Platform Accounts — move guest accounts and sign-in by emailed code out of shortlet into a platform
// Accounts module (ADR 0093 amended by ADR 0101, ADR 0094, ADR 0099 rule 2).

const shortletSource = fileURLToPath(new URL("../domains/shortlet/src", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
  });
}

test("AC1: Shortlet code has no account-session or emailed-code logic; it uses the platform Accounts module", () => {
  // Account-session and emailed-code logic only: the assurance store may still reference the account id (ADR 0094).
  const markers = ["guest_account_sessions", "guest_account_email_commands", "guest_account_rate_events", "GUEST_ACCOUNT_SCHEMA", "hashGuestAccountSessionSecret", "GUEST_ACCOUNT_POLICY_DEFAULTS", "requestSignInCode", "verifySignInCode"];
  const offenders: string[] = [];
  for (const file of sourceFiles(shortletSource)) {
    const source = readFileSync(file, "utf8");
    for (const marker of markers) {
      if (source.includes(marker)) offenders.push(`${path.relative(shortletSource, file)}: ${marker}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("AC2: Sign-in and linking work through the platform Accounts module, and a conflicting or forged link fails closed", () => {
  const database = new NodeSqliteDatabase(":memory:");
  try {
    const accounts = createPlatformAccounts({
      database,
      codeHashingKey: TEST_GUEST_CODE_HASHING_KEY,
      requests: { findBookingRequestIdsByContactEmail: () => [] },
    });

    const session = signInGuestAccount(accounts.authority, "guest@example.test", "tenant-1");
    const accountGuestId = session.account.accountGuestId;
    assert.match(accountGuestId, /^gacct-/);

    const linked = accounts.links.linkSignedInPrincipal({ principalId: "device-1", tenantId: "tenant-1", session });
    assert.equal(linked.link.principalId, "device-1");
    assert.deepEqual(accounts.links.accountForPrincipal("device-1"), { tenantId: "tenant-1", accountGuestId });
    assert.deepEqual(accounts.links.linkedPrincipals(accountGuestId, "tenant-1"), ["device-1"]);
    assert.equal(accounts.authority.resolveSession(session.sessionId, session.sessionSecret)?.accountGuestId, accountGuestId);

    // A forged session secret links nothing (ADR 0093).
    assert.throws(
      () => accounts.links.linkSignedInPrincipal({ principalId: "device-forged", tenantId: "tenant-1", session: { ...session, sessionSecret: "forged-secret" } }),
      /not valid for this tenant/,
    );

    // A principal already linked to another account is never moved (fail closed).
    const other = signInGuestAccount(accounts.authority, "other@example.test", "tenant-1");
    assert.throws(
      () => accounts.links.linkSignedInPrincipal({ principalId: "device-1", tenantId: "tenant-1", session: other }),
      /already linked to a different Guest Account/,
    );
    assert.equal(accounts.links.accountForPrincipal("device-1")?.accountGuestId, accountGuestId);

    // Signing out revokes the session (ADR 0093).
    accounts.authority.revokeSession(session.sessionId, "tenant-1");
    assert.equal(accounts.authority.resolveSession(session.sessionId, session.sessionSecret), null);
  } finally {
    database.close();
  }
});

test("AC3: Identity assurance is keyed by the Account Guest Id and resolves through the linked principal", async () => {
  const fixture = await createGuestIdentityAssuranceFixture();
  try {
    const session = fixture.signInDevice("guest-device-ac3", "ada@example.test");
    const accountGuestId = session.account.accountGuestId;
    fixture.assurance.recordOutcome(verifiedOutcome(accountGuestId));

    // The assurance row is the account's, and resolves for the principal linked to it.
    assert.equal(fixture.assurance.currentAssurance(accountGuestId, ASSURANCE_TENANT, fixture.now())?.accountGuestId, accountGuestId);
    assert.deepEqual(fixture.source.getVerificationResult({ tenantId: ASSURANCE_TENANT, guestId: "guest-device-ac3" }), {
      tenantId: ASSURANCE_TENANT,
      guestId: "guest-device-ac3",
      governmentIdVerified: true,
    });

    // An unknown account holds no current assurance (fail closed, ADR 0094).
    assert.equal(fixture.assurance.currentAssurance("gacct-does-not-exist", ASSURANCE_TENANT, fixture.now()), null);
  } finally {
    await fixture.close();
  }
});
