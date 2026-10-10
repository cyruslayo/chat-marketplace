import test from "node:test";
import assert from "node:assert/strict";
import { GuestAccountAuthorityError, authorizesBookingRequest, authorizesPrincipalOwner, anonymousGuestIdentity, GuestIdentityResolver, SqliteGuestAccountAuthority, SqliteGuestAccountLinks, SqliteGuestContactRepository, SqliteGuestInteractionStore } from "../domains/shortlet/src/index.js";
import { applySchemaMigrations } from "../packages/platform-core/src/schema-migrations.js";
import { resolveGuestContact, SqliteGuestContactRepository } from "../domains/shortlet/src/index.js";
import { SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../apps/cloudflare/src/schema.js";
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

test("AC1: After a Guest on device A signs in, a second principal on device B that signs into the same account sees A's threads, requests and bookings", async () => {
  await withFixture((fixture) => {
    fixture.saveThread({ threadId: "thread-a", principalId: "guest-device-a" });
    fixture.saveRequest({ requestId: "request-a", primaryGuestId: "guest-device-a", contactEmail: "ada@example.test" });
    fixture.saveBooking({ requestId: "request-a", offerId: "offer-a", reservationId: "reservation-a", contractId: "contract-a" });

    const accountA = fixture.signInDevice("guest-device-a", "ada@example.test");
    const accountB = fixture.signInDevice("guest-device-b", "ada@example.test");
    assert.equal(accountA.account.accountGuestId, accountB.account.accountGuestId);
    const identityB = fixture.resolver.resolve({ principalId: "guest-device-b", tenantId: LINKING_TENANT, accountSession: { sessionId: accountB.sessionId, sessionSecret: accountB.sessionSecret } });
    assert.ok(identityB);
    assert.deepEqual([...identityB.principalIds].sort(), ["guest-device-a", "guest-device-b"]);

    assert.deepEqual(fixture.store.findThreadsForPrincipals(identityB.principalIds, LINKING_TENANT).map((thread) => thread.threadId), ["thread-a"]);
    const requests = fixture.store.findBookingRequestsForPrincipals(identityB.principalIds, LINKING_TENANT);
    assert.deepEqual(requests.map((request) => request.requestId), ["request-a"]);
    // A booking is reached through its offer's request lineage, which the account's identity authorizes.
    const offer = fixture.store.findConditionalOffer("offer-a")!;
    const booking = fixture.store.findBookingSnapshotByOfferId(offer.offerId)!;
    assert.equal(booking.reservationId, "reservation-a");
    assert.ok(authorizesBookingRequest(identityB, fixture.store.findBookingRequest(offer.requestId)!));
  });
});

test("AC1 failure path: a third principal that is not linked to the account sees none of them", async () => {
  await withFixture((fixture) => {
    fixture.saveThread({ threadId: "thread-a", principalId: "guest-device-a" });
    fixture.saveRequest({ requestId: "request-a", primaryGuestId: "guest-device-a", contactEmail: "ada@example.test" });
    fixture.saveBooking({ requestId: "request-a", offerId: "offer-a", reservationId: "reservation-a", contractId: "contract-a" });
    fixture.signInDevice("guest-device-a", "ada@example.test");
    const account = fixture.authority.findAccountByEmail("ada@example.test", LINKING_TENANT)!;
    const sessionOfThird = fixture.signInDevice("guest-device-c", "grace@example.test");
    const thirdIdentity = fixture.resolver.resolve({ principalId: "guest-device-c", tenantId: LINKING_TENANT, accountSession: { sessionId: sessionOfThird.sessionId, sessionSecret: sessionOfThird.sessionSecret } });
    assert.ok(thirdIdentity);
    assert.notEqual(thirdIdentity.accountGuestId, account.accountGuestId);
    assert.deepEqual(fixture.store.findThreadsForPrincipals(thirdIdentity.principalIds, LINKING_TENANT), []);
    assert.deepEqual(fixture.store.findBookingRequestsForPrincipals(thirdIdentity.principalIds, LINKING_TENANT), []);
    assert.equal(authorizesBookingRequest(thirdIdentity, fixture.store.findBookingRequest("request-a")!), false);
    // An anonymous third device with no account session sees none either.
    const anonymous = fixture.resolver.resolve({ principalId: "guest-device-d", tenantId: LINKING_TENANT });
    assert.deepEqual(fixture.store.findThreadsForPrincipals(anonymous!.principalIds, LINKING_TENANT), []);
  });
});

test("AC2: Linking a principal that is already linked to another account fails and changes nothing", async () => {
  await withFixture((fixture) => {
    const first = fixture.signInDevice("guest-shared-device", "ada@example.test");
    const other = fixture.signInDevice("guest-other-account", "grace@example.test");
    const linkedBefore = fixture.database.prepare("SELECT * FROM guest_account_principals ORDER BY principal_id").all();
    assert.throws(
      () => fixture.links.linkPrincipal({ principalId: "guest-shared-device", tenantId: LINKING_TENANT, accountGuestId: other.account.accountGuestId }),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "account_conflict",
    );
    assert.deepEqual(fixture.database.prepare("SELECT * FROM guest_account_principals ORDER BY principal_id").all(), linkedBefore);
    assert.equal(fixture.links.accountForPrincipal("guest-shared-device")?.accountGuestId, first.account.accountGuestId);
    assert.deepEqual(fixture.links.linkedPrincipals(other.account.accountGuestId, LINKING_TENANT), ["guest-other-account"]);
  });
});

test("AC2: Re-linking a principal to the same account is a no-op", async () => {
  await withFixture((fixture) => {
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    const before = fixture.database.prepare("SELECT * FROM guest_account_principals").all();
    fixture.links.linkPrincipal({ principalId: "guest-device-a", tenantId: LINKING_TENANT, accountGuestId: session.account.accountGuestId });
    assert.deepEqual(fixture.database.prepare("SELECT * FROM guest_account_principals").all(), before);
  });
});

test("AC3: No row in guest_booking_requests, booking_contracts, booking_reservations or guest_booking_snapshots changes when principals are linked", async () => {
  await withFixture((fixture) => {
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

test("AC4: committedWork lists live work from every linked principal and only from them", async () => {
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
    const links = new SqliteGuestAccountLinks(handle, { requests: new SqliteGuestInteractionStore(handle) });
    const resolver = new GuestIdentityResolver(authority, links);
    const session = signInGuestAccount(authority, "ada@example.test", tenantId);
    links.linkSignedInPrincipal({ principalId: deviceA.environment.guestPrincipal().id, tenantId, accountGuestId: session.account.accountGuestId, email: "ada@example.test" });
    links.linkSignedInPrincipal({ principalId: deviceB.environment.guestPrincipal().id, tenantId, accountGuestId: session.account.accountGuestId, email: "ada@example.test" });
    const identity = resolver.resolve({ principalId: deviceA.environment.guestPrincipal().id, tenantId, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } });
    assert.ok(identity);

    const listed = deviceA.app.committedWork(deviceA.environment.guestPrincipal(), identity);
    assert.deepEqual(listed.map((work) => work.threadId).sort(), [deviceA.threadId, deviceB.threadId].sort());

    // Only from linked principals: the unlinked device's live work is not listed under the account.
    assert.equal(listed.some((work) => work.threadId === deviceC.threadId), false);
    // And a principal outside the account's linked set gets nothing from that identity (fail closed).
    assert.deepEqual(deviceC.app.committedWork(deviceC.environment.guestPrincipal(), identity), []);
    // Without an account the existing behaviour is unchanged: only the device's own work.
    assert.deepEqual(deviceA.app.committedWork(deviceA.environment.guestPrincipal()).map((work) => work.threadId), [deviceA.threadId]);
  } finally {
    handle.close();
    await deviceC.close();
    await deviceB.close();
    await deviceA.close();
  }
});

test("AC5: Opening a thread or offer owned by an unlinked principal is refused even with a valid account session; a record with a missing tenant is refused", async () => {
  await withFixture((fixture) => {
    fixture.saveThread({ threadId: "thread-stranger", principalId: "guest-stranger" });
    fixture.saveRequest({ requestId: "request-stranger", primaryGuestId: "guest-stranger", contactEmail: null });
    fixture.saveBooking({ requestId: "request-stranger", offerId: "offer-stranger", reservationId: "reservation-stranger", contractId: "contract-stranger" });
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    const identity = fixture.resolver.resolve({ principalId: "guest-device-a", tenantId: LINKING_TENANT, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } });
    assert.ok(identity?.accountGuestId, "the account session is valid");

    const strangerThread = fixture.store.findThread("thread-stranger")!;
    assert.equal(authorizesPrincipalOwner(identity, { principalId: strangerThread.principalId, tenantId: strangerThread.tenantId }), false);
    const strangerRequest = fixture.store.findBookingRequest("request-stranger")!;
    assert.equal(authorizesBookingRequest(identity, strangerRequest), false);
    const strangerOffer = fixture.store.findConditionalOffer("offer-stranger")!;
    assert.equal(strangerOffer.requestId, "request-stranger");
    assert.equal(authorizesBookingRequest(identity, { ...strangerRequest, tenantId: "tenant-other" }), false);

    // Missing tenant or missing owner fails closed, even for the account's own principal.
    assert.equal(authorizesPrincipalOwner(identity, { principalId: "guest-device-a", tenantId: undefined }), false);
    assert.equal(authorizesPrincipalOwner(identity, { principalId: "guest-device-a", tenantId: "" }), false);
    assert.equal(authorizesPrincipalOwner(identity, { principalId: undefined, tenantId: LINKING_TENANT }), false);
    assert.equal(authorizesPrincipalOwner(identity, { principalId: "guest-device-a", tenantId: "tenant-other" }), false);
    assert.equal(authorizesPrincipalOwner(null, { principalId: "guest-device-a", tenantId: LINKING_TENANT }), false);
  });
});

test("AC6: An anonymous session (no account) resolves to its own principal only and reads exactly as before", async () => {
  await withFixture((fixture) => {
    fixture.saveThread({ threadId: "thread-anon", principalId: "guest-anon" });
    fixture.saveThread({ threadId: "thread-other", principalId: "guest-other" });
    const anonymous = fixture.resolver.resolve({ principalId: "guest-anon", tenantId: LINKING_TENANT });
    assert.deepEqual(anonymous, anonymousGuestIdentity("guest-anon", LINKING_TENANT));
    assert.equal(anonymous?.accountGuestId, undefined);
    assert.equal(anonymous?.assurance, "anonymous");
    assert.deepEqual(fixture.store.findThreadsForPrincipals(anonymous!.principalIds, LINKING_TENANT).map((thread) => thread.threadId), ["thread-anon"]);
    // A session presented with a wrong secret, or with a session that was never issued, is anonymous, not an account.
    const forged = fixture.resolver.resolve({ principalId: "guest-anon", tenantId: LINKING_TENANT, accountSession: { sessionId: "gass-forged", sessionSecret: "forged" } });
    assert.equal(forged?.accountGuestId, undefined);
    assert.equal(forged?.assurance, "anonymous");
    assert.deepEqual(forged?.principalIds, ["guest-anon"]);
    // Missing principal or tenant yields no identity at all.
    assert.equal(fixture.resolver.resolve({ principalId: "", tenantId: LINKING_TENANT }), null);
    assert.equal(fixture.resolver.resolve({ principalId: "guest-anon", tenantId: "" }), null);
  });
});

test("AC7: After signing in with an email, a Booking Request made on another device with that contact email appears in the account", async () => {
  await withFixture((fixture) => {
    // Device B made the request before anyone signed in, with the contact email it recorded.
    fixture.saveRequest({ requestId: "request-on-device-b", primaryGuestId: "guest-device-b", contactEmail: "ada@example.test" });
    assert.equal(fixture.links.accountForPrincipal("guest-device-b"), null);

    // Device A signs in with that email on a new device; the principal and the matching request join the account.
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    const identity = fixture.resolver.resolve({ principalId: "guest-device-a", tenantId: LINKING_TENANT, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } });
    assert.ok(identity);
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), ["request-on-device-b"]);
    assert.equal(authorizesBookingRequest(identity, fixture.store.findBookingRequest("request-on-device-b")!), true);
    // The claim is scoped to the request: device B's principal is not linked and its other records are not reached.
    assert.equal(fixture.links.accountForPrincipal("guest-device-b"), null);
    assert.equal(authorizesPrincipalOwner(identity, { principalId: "guest-device-b", tenantId: LINKING_TENANT }), false);
  });
});

test("AC7 failure path: a request with a different contact email does not appear, and a principal already linked to another account is not moved", async () => {
  await withFixture((fixture) => {
    fixture.saveRequest({ requestId: "request-other-email", primaryGuestId: "guest-device-b", contactEmail: "grace@example.test" });
    // A request by a principal that already belongs to another account, even with the same email, is not claimed or moved.
    const owner = fixture.signInDevice("guest-owned-elsewhere", "grace@example.test");
    fixture.saveRequest({ requestId: "request-owned-elsewhere", primaryGuestId: "guest-owned-elsewhere", contactEmail: "ada@example.test" });

    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), []);
    const identity = fixture.resolver.resolve({ principalId: "guest-device-a", tenantId: LINKING_TENANT, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } });
    assert.equal(authorizesBookingRequest(identity!, fixture.store.findBookingRequest("request-other-email")!), false);
    assert.equal(authorizesBookingRequest(identity!, fixture.store.findBookingRequest("request-owned-elsewhere")!), false);
    assert.equal(fixture.links.accountForPrincipal("guest-owned-elsewhere")?.accountGuestId, owner.account.accountGuestId);

    // Signing in on a device whose principal is linked elsewhere fails and moves nothing.
    assert.throws(
      () => fixture.links.linkSignedInPrincipal({ principalId: "guest-owned-elsewhere", tenantId: LINKING_TENANT, accountGuestId: session.account.accountGuestId, email: "ada@example.test" }),
      (error: unknown) => error instanceof GuestAccountAuthorityError && error.code === "account_conflict",
    );
    assert.equal(fixture.links.accountForPrincipal("guest-owned-elsewhere")?.accountGuestId, owner.account.accountGuestId);
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), []);
  });
});

test("AC7 failure path: a legacy request with no recorded contact snapshot is not claimable by its current contact", async () => {
  await withFixture((fixture) => {
    fixture.saveRequest({ requestId: "request-legacy", primaryGuestId: "guest-device-b", contactEmail: null });
    // Even if the principal's current, mutable contact is the same email, no historical snapshot means no claim.
    new SqliteGuestContactRepository(fixture.database).saveEmail({ guestId: "guest-device-b", tenantId: LINKING_TENANT, contactEmail: "ada@example.test" });
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    assert.deepEqual(fixture.links.claimedRequestIds(session.account.accountGuestId, LINKING_TENANT), []);
  });
});

test("AC7 snapshot: a request's contact email is recorded once at creation and never rewritten by a later save", async () => {
  await withFixture((fixture) => {
    const request = fixture.saveRequest({ requestId: "request-frozen", primaryGuestId: "guest-device-b", contactEmail: "ada@example.test" });
    // A later save of the same request with a different email cannot rewrite the snapshot.
    fixture.store.saveBookingRequest({ ...request, status: "confirmed", confirmedAt: "2026-10-02T09:00:00.000Z", contactEmailSnapshot: "grace@example.test" });
    fixture.store.saveBookingRequest({ ...request, status: "confirmed", confirmedAt: "2026-10-02T09:00:00.000Z", contactEmailSnapshot: null });
    assert.deepEqual(fixture.store.findBookingRequestIdsByContactEmail("ada@example.test", LINKING_TENANT).map((match) => match.requestId), ["request-frozen"]);
    assert.deepEqual(fixture.store.findBookingRequestIdsByContactEmail("grace@example.test", LINKING_TENANT), []);
  });
});

test("Contact lookup consults the account's contact first, then the session principal's contact", async () => {
  await withFixture((fixture) => {
    const contacts = new SqliteGuestContactRepository(fixture.database);
    contacts.savePhone({ guestId: "guest-device-a", tenantId: LINKING_TENANT, phoneNumber: "08012345678" });
    const session = fixture.signInDevice("guest-device-a", "ada@example.test");
    const identity = fixture.resolver.resolve({ principalId: "guest-device-a", tenantId: LINKING_TENANT, accountSession: { sessionId: session.sessionId, sessionSecret: session.sessionSecret } })!;
    // No contact is recorded against the account yet, so the session principal's contact is used.
    assert.equal(resolveGuestContact(identity, contacts)?.guestId, "guest-device-a");
    // Once the account has its own contact, that one wins.
    contacts.savePhone({ guestId: session.account.accountGuestId, tenantId: LINKING_TENANT, phoneNumber: "08098765432" });
    assert.equal(resolveGuestContact(identity, contacts)?.guestId, session.account.accountGuestId);
    assert.equal(resolveGuestContact(anonymousGuestIdentity("guest-nobody", LINKING_TENANT), contacts), null);
  });
});

test("Schema: migration 3 creates the linking and snapshot tables on a database that already has migrations 1 and 2", () => {
  assert.equal(SHORTLET_SCHEMA_VERSION, 3);
  const database = openNodeSqliteDatabase(":memory:");
  try {
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS.slice(0, 2), "2026-10-10T00:00:00.000Z");
    applySchemaMigrations(database, SHORTLET_SCHEMA_MIGRATIONS, "2026-10-10T00:00:00.000Z");
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    for (const table of ["guest_account_principals", "guest_account_request_claims", "guest_booking_request_contacts"]) {
      assert.ok(tables.includes(table), `${table} exists after migration 3`);
    }
  } finally {
    database.close();
  }
});
