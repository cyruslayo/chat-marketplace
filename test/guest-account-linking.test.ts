import test from "node:test";
import assert from "node:assert/strict";
import { GuestAccountAuthorityError, authorizesBookingRequest, authorizesPrincipalOwner, anonymousGuestIdentity, GuestIdentityResolver, SqliteGuestAccountAuthority, SqliteGuestAccountLinks, SqliteGuestContactRepository, SqliteGuestInteractionStore } from "../domains/shortlet/src/index.js";
import { applySchemaMigrations } from "../packages/platform-core/src/schema-migrations.js";
import { normalizeContactEmail, resolveGuestContact, type GuestIdentity } from "../domains/shortlet/src/index.js";
import { PLATFORM_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../apps/cloudflare/src/schema.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { createGuestLinkingFixture, linkedTableRows, LINKING_TENANT, type GuestLinkingFixture } from "./helpers/guest-account-linking.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { TEST_GUEST_CODE_HASHING_KEY, signInGuestAccount } from "./helpers/guest-account-authority.js";

async function withFixture(run: (fixture: GuestLinkingFixture) => void | Promise<void>): Promise<void> {
  const fixture = await createGuestLinkingFixture();
  try {
    await run(fixture);
  } finally {
    await fixture.close();
  }
}

test("Slice 17 AC1: async remote contact lookup runs before the link transaction and stale email snapshots commit no ownership", async () => {
  await withFixture(async (fixture) => {
    const session = signInGuestAccount(fixture.authority, "ada@example.test", LINKING_TENANT);
    fixture.saveRequest({ requestId: "request-stale", primaryGuestId: "guest-stale", contactEmail: "ada@example.test" });
    const remoteLinks = new SqliteGuestAccountLinks(fixture.database, {
      requests: fixture.store,
      authority: fixture.authority,
      asyncRequests: {
        async findBookingRequestIdsByContactEmail() {
          // Re-entering the database here proves the async domain lookup is not inside a synchronous SQLite transaction.
          fixture.database.transaction(() => fixture.database.prepare("SELECT 1").get());
          fixture.database.prepare("UPDATE guest_accounts SET email_normalized = ?, email_revision = email_revision + 1, revision = revision + 1 WHERE account_guest_id = ?")
            .run(["ada.changed@example.test", session.account.accountGuestId]);
          return [{ requestId: "request-stale", primaryGuestId: "guest-stale", tenantId: LINKING_TENANT }];
        },
      },
    });
    await assert.rejects(remoteLinks.linkSignedInPrincipalWithLookup({ principalId: "guest-new-device", tenantId: LINKING_TENANT, session }), /changed during account linking/);
    assert.deepEqual(fixture.database.prepare("SELECT principal_id FROM guest_account_principals WHERE principal_id = ?").get(["guest-new-device"]), undefined);
    assert.deepEqual(fixture.database.prepare("SELECT request_id FROM guest_account_request_claims WHERE request_id = ?").get(["request-stale"]), undefined);
  });
});

test("AC1 (store and decision level): after a Guest on device A signs in, a second principal on device B that signs into the same account sees A's threads and requests, and the offer lineage authorizes", async () => {
  await withFixture(async (fixture) => {
    fixture.saveThread({ threadId: "thread-a", principalId: "guest-device-a" });
    fixture.saveRequest({ requestId: "request-a", primaryGuestId: "guest-device-a", contactEmail: "ada@example.test" });
    fixture.saveBooking({ requestId: "request-a", offerId: "offer-a", reservationId: "reservation-a", contractId: "contract-a" });

    const accountA = fixture.signInDevice("guest-device-a", "ada@example.test");
    const accountB = fixture.signInDevice("guest-device-b", "ada@example.test");
    assert.equal(accountA.account.accountGuestId, accountB.account.accountGuestId);
    const identityB = await fixture.resolver.resolve({ principalId: "guest-device-b", tenantId: LINKING_TENANT, accountSession: { sessionId: accountB.sessionId, sessionSecret: accountB.sessionSecret } });
    assert.ok(identityB);
    assert.deepEqual([...identityB.principalIds].sort(), ["guest-device-a", "guest-device-b"]);

    assert.deepEqual(fixture.store.findThreadsForPrincipals(identityB.principalIds, LINKING_TENANT).map((thread) => thread.threadId), ["thread-a"]);
    const requests = fixture.store.findBookingRequestsForPrincipals(identityB.principalIds, LINKING_TENANT);
    assert.deepEqual(requests.map((request) => request.requestId), ["request-a"]);
    // An offer is authorized through its request lineage, which the account's identity authorizes. No booking is read here.
    const offer = fixture.store.findConditionalOffer("offer-a")!;
    assert.ok(authorizesBookingRequest(identityB, fixture.store.findBookingRequest(offer.requestId)!));
  });
});

test("AC1 failure path (store and decision level): a third principal that is not linked to the account sees none of its threads or requests", async () => {
  await withFixture(async (fixture) => {
    fixture.saveThread({ threadId: "thread-a", principalId: "guest-device-a" });
    fixture.saveRequest({ requestId: "request-a", primaryGuestId: "guest-device-a", contactEmail: "ada@example.test" });
    fixture.saveBooking({ requestId: "request-a", offerId: "offer-a", reservationId: "reservation-a", contractId: "contract-a" });
    fixture.signInDevice("guest-device-a", "ada@example.test");
    const account = fixture.authority.findAccountByEmail("ada@example.test", LINKING_TENANT)!;
    const sessionOfThird = fixture.signInDevice("guest-device-c", "grace@example.test");
    const thirdIdentity = await fixture.resolver.resolve({ principalId: "guest-device-c", tenantId: LINKING_TENANT, accountSession: { sessionId: sessionOfThird.sessionId, sessionSecret: sessionOfThird.sessionSecret } });
    assert.ok(thirdIdentity);
    assert.notEqual(thirdIdentity.accountGuestId, account.accountGuestId);
    assert.deepEqual(fixture.store.findThreadsForPrincipals(thirdIdentity.principalIds, LINKING_TENANT), []);
    assert.deepEqual(fixture.store.findBookingRequestsForPrincipals(thirdIdentity.principalIds, LINKING_TENANT), []);
    assert.equal(authorizesBookingRequest(thirdIdentity, fixture.store.findBookingRequest("request-a")!), false);
    // An anonymous third device with no account session sees none either.
    const anonymous = await fixture.resolver.resolve({ principalId: "guest-device-d", tenantId: LINKING_TENANT });
    assert.deepEqual(fixture.store.findThreadsForPrincipals(anonymous!.principalIds, LINKING_TENANT), []);
  });
});

test("AC2: Linking a principal that is already linked to another account fails and changes nothing", async () => {
  await withFixture(async (fixture) => {
    const first = fixture.signInDevice("guest-shared-device", "ada@example.test");
    const other = fixture.signInDevice("guest-other-account", "grace@example.test");
    const linkedBefore = fixture.database.prepare("SELECT * FROM guest_account_principals ORDER BY principal_id").all();
    assert.throws(
      () => fixture.links.linkSignedInPrincipal({ principalId: "guest-shared-device", tenantId: LINKING_TENANT, session: other }),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "account_conflict",
    );
    assert.deepEqual(fixture.database.prepare("SELECT * FROM guest_account_principals ORDER BY principal_id").all(), linkedBefore);
    assert.equal(fixture.links.accountForPrincipal("guest-shared-device")?.accountGuestId, first.account.accountGuestId);
    assert.deepEqual(fixture.links.linkedPrincipals(other.account.accountGuestId, LINKING_TENANT), ["guest-other-account"]);
  });
});

test("AC2: Re-linking a principal to the same account is a no-op", async () => {
  await withFixture(async (fixture) => {
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    const before = fixture.database.prepare("SELECT * FROM guest_account_principals").all();
    fixture.links.linkSignedInPrincipal({ principalId: "guest-device-a", tenantId: LINKING_TENANT, session });
    assert.deepEqual(fixture.database.prepare("SELECT * FROM guest_account_principals").all(), before);
  });
});

test("AC3: No row in guest_booking_requests, booking_contracts, booking_reservations or guest_booking_snapshots changes when principals are linked", async () => {
  await withFixture(async (fixture) => {
    fixture.saveRequest({ requestId: "request-a", primaryGuestId: "guest-device-a", contactEmail: "ada@example.test" });
    fixture.saveRequest({ requestId: "request-b", primaryGuestId: "guest-device-b", contactEmail: "ada@example.test" });
    fixture.saveBooking({ requestId: "request-b", offerId: "offer-b", reservationId: "reservation-b", contractId: "contract-b" });
    fixture.database.prepare("INSERT INTO booking_contracts (contract_id, contract_json) VALUES (?, ?)").run(["contract-b", "{}"]);
    fixture.database.prepare("INSERT INTO booking_reservations (reservation_id, reservation_json) VALUES (?, ?)").run(["reservation-b", "{}"]);
    const before = linkedTableRows(fixture.database);

    // Sign-in links both devices and claims the matching request by email, which must touch none of the four tables.
    fixture.signInDevice("guest-device-a", "ada@example.test");
    fixture.signInDevice("guest-device-b", "ada@example.test");

    assert.deepEqual(linkedTableRows(fixture.database), before);
  });
});

test("AC4 (app level with an explicit identity; the HTTP route is issue 06): committedWork lists live work from every linked principal and only from them", async () => {
  // Three devices on one database file: A and B sign into the same account, C never does (ADR 0004: one authority, one file).
  const deviceA = await restartFixture();
  const deviceB = await restartFixture({ guestId: "guest-device-b", databasePath: deviceA.databasePath });
  const deviceC = await restartFixture({ guestId: "guest-device-c", databasePath: deviceA.databasePath });
  // The account lives in the runtime tenant, so every link and session is scoped to it (ADR 0093).
  const tenantId = deviceA.environment.config.tenantId;
  const handle = openNodeSqliteDatabase(deviceA.databasePath);
  try {
    // Each device asks for a different stay: one unit is held by one live request for a given stay (ADR 0041).
    await deviceA.advance("pending");
    await deviceB.advance("pending", undefined, "I need an apartment in Ikoyi from 20 Sept for 2 nights for 1 person");
    await deviceC.advance("pending", undefined, "I need an apartment in Ikoyi from 25 Sept for 2 nights for 1 person");
    const authority = new SqliteGuestAccountAuthority(handle, { codeHashingKey: TEST_GUEST_CODE_HASHING_KEY });
    const links = new SqliteGuestAccountLinks(handle, { requests: new SqliteGuestInteractionStore(handle), authority });
    const resolver = new GuestIdentityResolver(authority, links, { hasCurrentGovernmentId: () => false });
    const session = signInGuestAccount(authority, "ada@example.test", tenantId);
    links.linkSignedInPrincipal({ principalId: deviceA.environment.guestPrincipal().id, tenantId, session });
    links.linkSignedInPrincipal({ principalId: deviceB.environment.guestPrincipal().id, tenantId, session });
    const identity = await resolver.resolve({ principalId: deviceA.environment.guestPrincipal().id, tenantId, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } });
    assert.ok(identity);
    // Issue 07: the resolver reports the level the identity-assurance port gives, and email-verified otherwise.
    assert.equal(identity.assurance, "email-verified");
    const verifiedResolver = new GuestIdentityResolver(authority, links, { hasCurrentGovernmentId: () => true });
    const verifiedIdentity = await verifiedResolver.resolve({ principalId: deviceA.environment.guestPrincipal().id, tenantId, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } });
    assert.equal(verifiedIdentity?.assurance, "government-ID-verified");

    const listed = await deviceA.app.committedWork(deviceA.environment.guestPrincipal(), identity);
    assert.deepEqual(listed.map((work) => work.threadId).sort(), [deviceA.threadId, deviceB.threadId].sort());

    // Only from linked principals: the unlinked device's live work is not listed under the account.
    assert.equal(listed.some((work) => work.threadId === deviceC.threadId), false);
    // And a principal outside the account's linked set gets nothing from that identity (fail closed).
    assert.deepEqual(await deviceC.app.committedWork(deviceC.environment.guestPrincipal(), identity), []);
    // Without an account the existing behaviour is unchanged: only the device's own work.
    assert.deepEqual((await deviceA.app.committedWork(deviceA.environment.guestPrincipal())).map((work) => work.threadId), [deviceA.threadId]);
  } finally {
    handle.close();
    await deviceC.close();
    await deviceB.close();
    await deviceA.close();
  }
});

test("AC5 (authorization decision only; the HTTP refusal is issue 06): a thread, request or offer of an unlinked principal is not authorized under a valid account identity, and a missing or other tenant is refused", async () => {
  await withFixture(async (fixture) => {
    fixture.saveThread({ threadId: "thread-stranger", principalId: "guest-stranger" });
    fixture.saveRequest({ requestId: "request-stranger", primaryGuestId: "guest-stranger", contactEmail: null });
    fixture.saveBooking({ requestId: "request-stranger", offerId: "offer-stranger", reservationId: "reservation-stranger", contractId: "contract-stranger" });
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    const identity = await fixture.resolver.resolve({ principalId: "guest-device-a", tenantId: LINKING_TENANT, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } });
    assert.ok(identity?.accountGuestId, "the account session is valid");

    const strangerThread = fixture.store.findThread("thread-stranger")!;
    assert.equal(authorizesPrincipalOwner(identity, { principalId: strangerThread.principalId, tenantId: strangerThread.tenantId }), false);
    const strangerRequest = fixture.store.findBookingRequest("request-stranger")!;
    assert.equal(authorizesBookingRequest(identity, strangerRequest), false);
    // The offer is authorized through its request lineage, which this identity does not own.
    const strangerOffer = fixture.store.findConditionalOffer("offer-stranger")!;
    assert.equal(authorizesBookingRequest(identity, fixture.store.findBookingRequest(strangerOffer.requestId)!), false);
    assert.equal(authorizesBookingRequest(identity, { ...strangerRequest, tenantId: "tenant-other" }), false);

    // Missing tenant or missing owner fails closed, even for the account's own principal.
    assert.equal(authorizesPrincipalOwner(identity, { principalId: "guest-device-a", tenantId: undefined }), false);
    assert.equal(authorizesPrincipalOwner(identity, { principalId: "guest-device-a", tenantId: "" }), false);
    assert.equal(authorizesPrincipalOwner(identity, { principalId: undefined, tenantId: LINKING_TENANT }), false);
    assert.equal(authorizesPrincipalOwner(identity, { principalId: "guest-device-a", tenantId: "tenant-other" }), false);
    assert.equal(authorizesPrincipalOwner(null, { principalId: "guest-device-a", tenantId: LINKING_TENANT }), false);
  });
});

test("AC5 resolver: a principal with no link row, presented under an account session, resolves to anonymous", async () => {
  await withFixture(async (fixture) => {
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    // guest-never-linked has no link row at all: the account session must not lend it the account's history.
    const identity = await fixture.resolver.resolve({ principalId: "guest-never-linked", tenantId: LINKING_TENANT, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } });
    assert.equal(identity?.accountGuestId, undefined);
    assert.equal(identity?.assurance, "anonymous");
    assert.deepEqual(identity?.principalIds, ["guest-never-linked"]);
    assert.deepEqual(identity?.claimedRequestIds, []);
  });
});

test("AC5 resolver: a principal linked to account X, presented under account Y's session, resolves to anonymous", async () => {
  await withFixture(async (fixture) => {
    fixture.signInDevice("guest-owned-by-x", "ada@example.test");
    const sessionY = fixture.signInDevice("guest-device-y", "grace@example.test");
    const identity = await fixture.resolver.resolve({ principalId: "guest-owned-by-x", tenantId: LINKING_TENANT, accountSession: { sessionId: sessionY.sessionId, sessionSecret: sessionY.sessionSecret } });
    assert.equal(identity?.accountGuestId, undefined);
    assert.equal(identity?.assurance, "anonymous");
    assert.deepEqual(identity?.principalIds, ["guest-owned-by-x"]);
  });
});

test("Human decision 2 (11 Oct 2026): a verified session cannot link a principal in another tenant, and writes nothing", async () => {
  await withFixture(async (fixture) => {
    fixture.saveRequest({ requestId: "request-grace", primaryGuestId: "guest-device-b", contactEmail: "grace@example.test" });
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    const principalsBefore = fixture.database.prepare("SELECT * FROM guest_account_principals ORDER BY principal_id").all();
    const claimsBefore = fixture.database.prepare("SELECT * FROM guest_account_request_claims ORDER BY request_id").all();
    assert.throws(
      () => fixture.links.linkSignedInPrincipal({ principalId: "guest-device-c", tenantId: "tenant-other", session }),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "session_invalid",
    );
    assert.equal(fixture.links.accountForPrincipal("guest-device-c"), null);
    assert.deepEqual(fixture.database.prepare("SELECT * FROM guest_account_principals ORDER BY principal_id").all(), principalsBefore);
    assert.deepEqual(fixture.database.prepare("SELECT * FROM guest_account_request_claims ORDER BY request_id").all(), claimsBefore);
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), []);
  });
});

test("AC4 failure path: an account identity from another tenant lists no work, even for its own principal", async () => {
  const device = await restartFixture();
  try {
    await device.advance("pending");
    const principal = device.environment.guestPrincipal();
    const sameTenant: GuestIdentity = { principalId: principal.id, tenantId: device.environment.config.tenantId, accountGuestId: "gacct-same-tenant", assurance: "email-verified", principalIds: [principal.id], claimedRequestIds: [] };
    const otherTenant: GuestIdentity = { ...sameTenant, tenantId: "tenant-other" };
    // The same identity, in its own tenant, lists the live work, so the empty result below is the tenant check, not an empty fixture.
    assert.equal((await device.app.committedWork(principal, sameTenant)).length, 1);
    assert.deepEqual(await device.app.committedWork(principal, otherTenant), []);
  } finally {
    await device.close();
  }
});

test("Human decision 3 (11 Oct 2026): a request recorded as Ada@x.test is claimed by ada@x.test, in either direction", async () => {
  await withFixture(async (fixture) => {
    // The store writes the snapshot normalised (lowercase), so both recorded and signed-in addresses meet in one form.
    fixture.saveRequest({ requestId: "request-legacy-case", primaryGuestId: "guest-device-b", contactEmail: "Ada@x.test" });
    const session = fixture.signInDevice("guest-device-a", "ada@x.test");
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), ["request-legacy-case"]);

    // The reverse: a request recorded lowercase, and an account signing in with mixed case.
    fixture.saveRequest({ requestId: "request-lower", primaryGuestId: "guest-device-c", contactEmail: "grace@x.test" });
    const sessionGrace = fixture.signInDevice("guest-device-d", "Grace@X.Test");
    assert.deepEqual(fixture.links.claimedRequestIds(sessionGrace.account.accountGuestId, LINKING_TENANT), ["request-lower"]);
  });
});

test("Human decision 3 (11 Oct 2026): different addresses still do not match, whatever their case", async () => {
  await withFixture(async (fixture) => {
    fixture.saveRequest({ requestId: "request-other-local", primaryGuestId: "guest-device-b", contactEmail: "ada2@x.test" });
    fixture.saveRequest({ requestId: "request-other-domain", primaryGuestId: "guest-device-c", contactEmail: "ada@y.test" });
    const session = fixture.signInDevice("guest-device-a", "ADA@x.test");
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), []);
  });
});

test("Human decision 1 (10 Oct 2026): normalizeContactEmail trims and lowercases the whole address", () => {
  assert.equal(normalizeContactEmail("  Ada.Lovelace@X.Test "), "ada.lovelace@x.test");
  assert.equal(normalizeContactEmail("ada@x.test"), "ada@x.test");
});

test("AC6: An anonymous session (no account) resolves to its own principal only and reads exactly as before", async () => {
  await withFixture(async (fixture) => {
    fixture.saveThread({ threadId: "thread-anon", principalId: "guest-anon" });
    fixture.saveThread({ threadId: "thread-other", principalId: "guest-other" });
    const anonymous = await fixture.resolver.resolve({ principalId: "guest-anon", tenantId: LINKING_TENANT });
    assert.deepEqual(anonymous, anonymousGuestIdentity("guest-anon", LINKING_TENANT));
    assert.equal(anonymous?.accountGuestId, undefined);
    assert.equal(anonymous?.assurance, "anonymous");
    assert.deepEqual(fixture.store.findThreadsForPrincipals(anonymous!.principalIds, LINKING_TENANT).map((thread) => thread.threadId), ["thread-anon"]);
    // A session presented with a wrong secret, or with a session that was never issued, is anonymous, not an account.
    const forged = await fixture.resolver.resolve({ principalId: "guest-anon", tenantId: LINKING_TENANT, accountSession: { sessionId: "gass-forged", sessionSecret: "forged" } });
    assert.equal(forged?.accountGuestId, undefined);
    assert.equal(forged?.assurance, "anonymous");
    assert.deepEqual(forged?.principalIds, ["guest-anon"]);
    // Missing principal or tenant yields no identity at all.
    assert.equal(await fixture.resolver.resolve({ principalId: "", tenantId: LINKING_TENANT }), null);
    assert.equal(await fixture.resolver.resolve({ principalId: "guest-anon", tenantId: "" }), null);
  });
});

test("AC7 (store and decision level): after signing in with an email, a Booking Request made on another device with that contact email is claimed by the account", async () => {
  await withFixture(async (fixture) => {
    // Device B made the request before anyone signed in, with the contact email it recorded.
    fixture.saveRequest({ requestId: "request-on-device-b", primaryGuestId: "guest-device-b", contactEmail: "ada@example.test" });
    assert.equal(fixture.links.accountForPrincipal("guest-device-b"), null);

    // Device A signs in with that email on a new device; the principal and the matching request join the account.
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    const identity = await fixture.resolver.resolve({ principalId: "guest-device-a", tenantId: LINKING_TENANT, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } });
    assert.ok(identity);
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), ["request-on-device-b"]);
    assert.equal(authorizesBookingRequest(identity, fixture.store.findBookingRequest("request-on-device-b")!), true);
    // The claim is scoped to the request: device B's principal is not linked and its other records are not reached.
    assert.equal(fixture.links.accountForPrincipal("guest-device-b"), null);
    assert.equal(authorizesPrincipalOwner(identity, { principalId: "guest-device-b", tenantId: LINKING_TENANT }), false);
  });
});

test("AC7 failure path: a request with a different contact email does not appear, and a principal already linked to another account is not moved", async () => {
  await withFixture(async (fixture) => {
    fixture.saveRequest({ requestId: "request-other-email", primaryGuestId: "guest-device-b", contactEmail: "grace@example.test" });
    // A request by a principal that already belongs to another account, even with the same email, is not claimed or moved.
    const owner = fixture.signInDevice("guest-owned-elsewhere", "grace@example.test");
    fixture.saveRequest({ requestId: "request-owned-elsewhere", primaryGuestId: "guest-owned-elsewhere", contactEmail: "ada@example.test" });

    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), []);
    const identity = await fixture.resolver.resolve({ principalId: "guest-device-a", tenantId: LINKING_TENANT, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } });
    assert.equal(authorizesBookingRequest(identity!, fixture.store.findBookingRequest("request-other-email")!), false);
    assert.equal(authorizesBookingRequest(identity!, fixture.store.findBookingRequest("request-owned-elsewhere")!), false);
    assert.equal(fixture.links.accountForPrincipal("guest-owned-elsewhere")?.accountGuestId, owner.account.accountGuestId);

    // Signing in on a device whose principal is linked elsewhere fails and moves nothing.
    assert.throws(
      () => fixture.links.linkSignedInPrincipal({ principalId: "guest-owned-elsewhere", tenantId: LINKING_TENANT, session }),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "account_conflict",
    );
    assert.equal(fixture.links.accountForPrincipal("guest-owned-elsewhere")?.accountGuestId, owner.account.accountGuestId);
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), []);
  });
});

test("AC7 failure path: a legacy request with no recorded contact snapshot is not claimable by its current contact", async () => {
  await withFixture(async (fixture) => {
    fixture.saveRequest({ requestId: "request-legacy", primaryGuestId: "guest-device-b", contactEmail: null });
    // Even if the principal's current, mutable contact is the same email, no historical snapshot means no claim.
    new SqliteGuestContactRepository(fixture.database).saveEmail({ guestId: "guest-device-b", tenantId: LINKING_TENANT, contactEmail: "ada@example.test" });
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), []);
  });
});

test("AC7 snapshot: a request's contact email is recorded once at creation and never rewritten by a later save", async () => {
  await withFixture(async (fixture) => {
    const request = fixture.saveRequest({ requestId: "request-frozen", primaryGuestId: "guest-device-b", contactEmail: "ada@example.test" });
    // A later save of the same request with a different email cannot rewrite the snapshot.
    fixture.store.saveBookingRequest({ ...request, status: "confirmed", confirmedAt: "2026-10-02T09:00:00.000Z", contactEmailSnapshot: "grace@example.test" });
    fixture.store.saveBookingRequest({ ...request, status: "confirmed", confirmedAt: "2026-10-02T09:00:00.000Z", contactEmailSnapshot: null });
    assert.deepEqual(fixture.store.findBookingRequestIdsByContactEmail("ada@example.test", LINKING_TENANT).map((match) => match.requestId), ["request-frozen"]);
    assert.deepEqual(fixture.store.findBookingRequestIdsByContactEmail("grace@example.test", LINKING_TENANT), []);
  });
});

test("Contact lookup consults the account's contact first, then the session principal's contact", async () => {
  await withFixture(async (fixture) => {
    const contacts = new SqliteGuestContactRepository(fixture.database);
    contacts.savePhone({ guestId: "guest-device-a", tenantId: LINKING_TENANT, phoneNumber: "08012345678" });
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    const identity = await fixture.resolver.resolve({ principalId: "guest-device-a", tenantId: LINKING_TENANT, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } })!;
    // No contact is recorded against the account yet, so the session principal's contact is used.
    assert.equal(resolveGuestContact(identity, contacts)?.guestId, "guest-device-a");
    // Once the account has its own contact, that one wins.
    contacts.savePhone({ guestId: session.account.accountGuestId, tenantId: LINKING_TENANT, phoneNumber: "08098765432" });
    assert.equal(resolveGuestContact(identity, contacts)?.guestId, session.account.accountGuestId);
    assert.equal(resolveGuestContact(anonymousGuestIdentity("guest-nobody", LINKING_TENANT), contacts), null);
  });
});

test("Human decision 2 (11 Oct 2026): a plain email string is not proof of sign-in, so linking with it fails closed and writes nothing", async () => {
  await withFixture(async (fixture) => {
    const owner = fixture.signInDevice("guest-owner", "ada@example.test");
    const principalsBefore = fixture.database.prepare("SELECT * FROM guest_account_principals ORDER BY principal_id").all();
    const claimsBefore = fixture.database.prepare("SELECT * FROM guest_account_request_claims ORDER BY request_id").all();
    // The pre-fix call shape: a principal, an account id and an email string, with no verified sign-in behind them.
    const forged = { principalId: "guest-forged", tenantId: LINKING_TENANT, accountGuestId: owner.account.accountGuestId, email: "ada@example.test" };
    assert.throws(
      () => fixture.links.linkSignedInPrincipal(forged as unknown as Parameters<SqliteGuestAccountLinks["linkSignedInPrincipal"]>[0]),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "session_invalid",
    );
    assert.equal(fixture.links.accountForPrincipal("guest-forged"), null);
    assert.deepEqual(fixture.database.prepare("SELECT * FROM guest_account_principals ORDER BY principal_id").all(), principalsBefore);
    assert.deepEqual(fixture.database.prepare("SELECT * FROM guest_account_request_claims ORDER BY request_id").all(), claimsBefore);
  });
});

test("Human decision 2 (11 Oct 2026): a forged session secret is refused and writes nothing", async () => {
  await withFixture(async (fixture) => {
    fixture.saveRequest({ requestId: "request-forged-secret", primaryGuestId: "guest-device-b", contactEmail: "ada@example.test" });
    const genuine = fixture.signInDevice("guest-device-a", "ada@example.test");
    const linksBefore = fixture.database.prepare("SELECT * FROM guest_account_principals ORDER BY principal_id").all();
    const claimsBefore = fixture.database.prepare("SELECT * FROM guest_account_request_claims ORDER BY request_id").all();
    assert.throws(
      () => fixture.links.linkSignedInPrincipal({ principalId: "guest-forged-secret", tenantId: LINKING_TENANT, session: { ...genuine, sessionSecret: "forged-secret" } }),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "session_invalid",
    );
    assert.equal(fixture.links.accountForPrincipal("guest-forged-secret"), null);
    assert.deepEqual(fixture.database.prepare("SELECT * FROM guest_account_principals ORDER BY principal_id").all(), linksBefore);
    assert.deepEqual(fixture.database.prepare("SELECT * FROM guest_account_request_claims ORDER BY request_id").all(), claimsBefore);
  });
});

test("Human decision 2 (11 Oct 2026): a revoked sign-in session is refused and writes nothing", async () => {
  await withFixture(async (fixture) => {
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    fixture.authority.revokeSession(session.sessionId, LINKING_TENANT);
    assert.throws(
      () => fixture.links.linkSignedInPrincipal({ principalId: "guest-device-z", tenantId: LINKING_TENANT, session }),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "session_invalid",
    );
    assert.equal(fixture.links.accountForPrincipal("guest-device-z"), null);
  });
});

test("Human decision 2 (11 Oct 2026): a genuine verified sign-in links the principal and claims its matching requests", async () => {
  await withFixture(async (fixture) => {
    fixture.saveRequest({ requestId: "request-genuine", primaryGuestId: "guest-device-b", contactEmail: "ada@example.test" });
    const session = signInGuestAccount(fixture.authority, "ada@example.test", LINKING_TENANT);
    const result = fixture.links.linkSignedInPrincipal({ principalId: "guest-device-a", tenantId: LINKING_TENANT, session });
    assert.equal(result.link.accountGuestId, session.account.accountGuestId);
    assert.deepEqual(result.claimedRequestIds, ["request-genuine"]);
  });
});

test("Human decision 3 (11 Oct 2026): signing in with a differently-cased address finds the same account and creates no duplicate", async () => {
  await withFixture(async (fixture) => {
    const first = fixture.signInDevice("guest-device-a", "Ada@Example.Test");
    const second = fixture.signInDevice("guest-device-b", "ada@example.test");
    assert.equal(second.account.accountGuestId, first.account.accountGuestId);
    assert.equal(fixture.database.prepare("SELECT COUNT(*) AS total FROM guest_accounts WHERE tenant_id = ?").get([LINKING_TENANT])?.total, 1);
    assert.deepEqual(fixture.links.linkedPrincipals(first.account.accountGuestId, LINKING_TENANT), ["guest-device-a", "guest-device-b"]);
  });
});

test("Human decision 3 (11 Oct 2026): a stored snapshot that is not in normalised form is not claimed, because the comparison is exact", async () => {
  await withFixture(async (fixture) => {
    fixture.saveRequest({ requestId: "request-raw-snapshot", primaryGuestId: "guest-device-b", contactEmail: null });
    // A row written outside the store's normalising path, as an unnormalised value would be. No SQL lower() may match it.
    fixture.database.prepare("INSERT INTO guest_booking_request_contacts (request_id, tenant_id, contact_email, recorded_at) VALUES (?, ?, ?, ?)")
      .run(["request-raw-snapshot", LINKING_TENANT, "Ada@x.test", "2026-10-01T10:00:00.000Z"]);
    const session = fixture.signInDevice("guest-device-a", "ada@x.test");
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), []);
  });
});

test("Human decision 3 (11 Oct 2026): an account row stored in a non-normalised form is not matched by lookup, because the comparison is exact", async () => {
  await withFixture(async (fixture) => {
    // Sign-in and email change both store the normalised value, so this row is reachable only by writing it directly.
    const session = fixture.signInDevice("guest-device-a", "ada@x.test");
    fixture.database.prepare("UPDATE guest_accounts SET email_normalized = ? WHERE account_guest_id = ?").run(["Ada@x.test", session.account.accountGuestId]);
    // The lookup normalises its input to "ada@x.test" and compares it exactly, with no SQL lower() folding the stored case.
    assert.equal(fixture.authority.findAccountByEmail("ada@x.test", LINKING_TENANT), null);
  });
});

test("Human decision 3 (11 Oct 2026): a non-ASCII address is allowed and matches in any case", async () => {
  await withFixture(async (fixture) => {
    fixture.saveRequest({ requestId: "request-non-ascii", primaryGuestId: "guest-device-b", contactEmail: "\u00d1and\u00fa@x.test" });
    const session = fixture.signInDevice("guest-device-a", "\u00f1AND\u00da@X.test");
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), ["request-non-ascii"]);
  });
});

test("AC5 authorization: a request the account claims is refused when it carries another tenant", async () => {
  await withFixture(async (fixture) => {
    fixture.saveRequest({ requestId: "request-claimed", primaryGuestId: "guest-device-b", contactEmail: "ada@example.test" });
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    const identity = await fixture.resolver.resolve({ principalId: "guest-device-a", tenantId: LINKING_TENANT, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } });
    assert.ok(identity);
    const claimed = fixture.store.findBookingRequest("request-claimed")!;
    // Control: the claim alone authorizes this request, because its primary guest is not linked.
    assert.equal(authorizesBookingRequest(identity, claimed), true);
    assert.equal(authorizesBookingRequest(identity, { ...claimed, tenantId: "tenant-other" }), false);
    assert.equal(authorizesBookingRequest(identity, { ...claimed, tenantId: undefined }), false);
  });
});

test("Slice 17 ADR 0101: linked principals live on platform while immutable request contacts remain shortlet", () => {
  assert.equal(SHORTLET_SCHEMA_VERSION, 4);
  const shortlet = openNodeSqliteDatabase(":memory:");
  const platform = openNodeSqliteDatabase(":memory:");
  try {
    applySchemaMigrations(shortlet, SHORTLET_SCHEMA_MIGRATIONS, "2026-10-10T00:00:00.000Z");
    applySchemaMigrations(platform, PLATFORM_SCHEMA_MIGRATIONS, "2026-10-10T00:00:00.000Z");
    const shortletTables = new Set(shortlet.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const platformTables = new Set(platform.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    for (const table of ["guest_accounts", "guest_account_sessions", "guest_account_email_commands", "guest_account_rate_events", "guest_account_principals", "guest_account_request_claims", "guest_contacts", "guest_threads", "guest_session_bindings", "audit_log", "telemetry_events"]) {
      assert.ok(platformTables.has(table), `${table} exists in PLATFORM`);
      assert.ok(!shortletTables.has(table), `${table} is absent from SHORTLET`);
    }
    for (const table of ["guest_booking_request_contacts", "guest_identity_assurance", "guest_booking_requests", "booking_reservations"]) {
      assert.ok(shortletTables.has(table), `${table} exists in SHORTLET`);
      assert.ok(!platformTables.has(table), `${table} is absent from PLATFORM`);
    }
  } finally {
    shortlet.close();
    platform.close();
  }
});
