import assert from "node:assert/strict";
import test from "node:test";
import { SqliteGuestInteractionStore } from "../domains/shortlet/src/index.js";
import { buildExport } from "../packages/platform-core/src/data-migration.js";
import { DirectPaystackClient } from "../packages/platform-core/src/payments/index.js";
import type { SqlDatabase, SqlRow } from "../packages/platform-core/src/sql-database.js";
import { createPaystackHttpFake } from "./helpers/paystack-http.js";
import { scriptedPlanner, trueRestartedDatedApp, type DatedFixture } from "./helpers/guest-date-fixtures.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { PAYSTACK_CONFIG, handoffAfterEmailSave, harness, initializeReferences, startRefusedCheckout, switchableFetcher } from "./helpers/paystack-checkout-journey.js";

// Issue 66 (ADR 0087, 0046, 0044, 0106, 0075, 0096): the durable checkout session keeps the Paystack checkout address the
// server received, so a cold restore reuses it instead of initializing Paystack again with the same reference. Every test is
// the staging-like guest of test/helpers/paystack-checkout-journey.ts (no seeded phone or email, the assistant runtime
// enabled, the 27 Oct 2026 clock), and every follow of /continue runs on a fresh process over the same database (ADR 0106).

/** The distinctive part of every checkout address the fake issues, so a leak is one substring search. */
const TOKEN = "co-66-";
const LEGACY_REFERENCE = "psp_ref_6f1c2d3e_1793000000000";
const CONFORMING = /^[A-Za-z0-9-]+$/;

function checkoutFor(reference: string): string {
  return `https://checkout.paystack.com/${TOKEN}${reference}`;
}

function fakeWithCheckouts() {
  return createPaystackHttpFake({ authorizationUrl: checkoutFor });
}

/** The next request's process: the previous environment is closed, a new one is opened over the same database file. */
function freshProcess(previous: DatedFixture): DatedFixture {
  return trueRestartedDatedApp(previous, scriptedPlanner({}).client);
}

/** The server work of `/payments/offers/<id>/continue` (ADR 0087): the Paystack start for the attempt on this process. */
function continueOn(fixture: DatedFixture, offerId: string) {
  const environment = fixture.environment;
  return environment.cardPaymentApp.initializePaystackCheckout(offerId, environment.guestPrincipal(), environment.payments);
}

function offerPathOf(state: unknown): string {
  const match = /\/payments\/offers\/[^"\\/]+/.exec(JSON.stringify(state));
  assert.ok(match, "the payment surface names its offer route");
  return match[0];
}

async function followContinue(fixture: { readonly base: string; readonly cookie: string }, offerPath: string): Promise<{ status: number; location: string | null; body: string }> {
  const response = await fetch(`${fixture.base}${offerPath}/continue`, { headers: { cookie: fixture.cookie, accept: "text/html" }, redirect: "manual" });
  return { status: response.status, location: response.headers.get("location"), body: await response.text() };
}

/** Every table's rows as JSON, with the checkout address column left out (it is the one place the address may live). */
function databaseTextWithoutAddress(database: SqlDatabase): string {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name));
  return tables.map((table) => JSON.stringify(database.prepare(`SELECT * FROM "${table}"`).all().map((row: SqlRow) => {
    if (table !== "guest_checkout_sessions") return row;
    const { checkout_url: _address, ...rest } = row;
    return rest;
  }))).join("\n");
}

test("After a cold restore, following /continue twice for the same attempt calls Paystack initialize once and redirects both times to the same stored address", async () => {
  const fake = fakeWithCheckouts();
  const h = harness("g-d1c6600101", fake.fetcher);
  let fixture = h.f;
  try {
    const { offerId } = await handoffAfterEmailSave(h);
    assert.deepEqual(initializeReferences(fake.requests), [], "saving the email starts no provider transaction");

    fixture = freshProcess(fixture);
    const first = await continueOn(fixture, offerId);
    fixture = freshProcess(fixture);
    const second = await continueOn(fixture, offerId);

    assert.deepEqual(initializeReferences(fake.requests), [first.pspReference], "Paystack is initialized once, for the attempt's own reference");
    assert.equal(first.checkoutUrl, checkoutFor(first.pspReference), "the first follow redirects to the approved address Paystack issued");
    assert.equal(second.checkoutUrl, first.checkoutUrl, "the second follow, after a cold restore, redirects to the same stored address");
    assert.equal(second.pspReference, first.pspReference, "the second follow is the same Live Payment Attempt");
  } finally { fixture.close(); }
});

test("AC1 at the route: the /continue 303 Location is the same on both restored requests and Paystack initializes once", async () => {
  const fake = createPaystackHttpFake({ authorizationUrl: checkoutFor });
  const fixture = await restartFixture({}, { paystackClient: new DirectPaystackClient(PAYSTACK_CONFIG, fake.fetcher) });
  try {
    await fixture.advance("payment-ready");
    const offerPath = offerPathOf(await fixture.state());
    const first = await followContinue(fixture, offerPath);
    await fixture.restart();
    const second = await followContinue(fixture, offerPath);

    assert.equal(first.status, 303, "the first follow redirects to the hosted checkout");
    assert.equal(second.status, 303, "the restored follow redirects to the hosted checkout");
    assert.equal(second.location, first.location, "both redirects name the same stored address");
    assert.equal(initializeReferences(fake.requests).length, 1, "Paystack is initialized once across the two follows");
  } finally { await fixture.close(); }
});

test("The stored address survives a restore of the durable row (node SQLite store and the Worker store)", async () => {
  const fake = fakeWithCheckouts();
  const h = harness("g-d1c6600102", fake.fetcher);
  let fixture = h.f;
  try {
    const { offerId } = await handoffAfterEmailSave(h);
    const first = await continueOn(fixture, offerId);

    fixture = freshProcess(fixture);
    assert.equal(fixture.environment.cardPaymentApp.getCheckoutSession(offerId)?.checkoutUrl, first.checkoutUrl, "the restored session holds the approved address");
    assert.equal(fixture.environment.interactionStore.findCheckoutSession(first.checkoutId)?.checkoutUrl, first.checkoutUrl, "the durable row holds the approved address");

    // A database written before this change has no address column. The store's constructor adds it (as it did for contact_email),
    // and the old row has no address, so the next follow initializes Paystack again for the same reference (fail closed).
    fixture.environment.database.exec("ALTER TABLE guest_checkout_sessions DROP COLUMN checkout_url");
    new SqliteGuestInteractionStore(fixture.environment.database);
    const columns = fixture.environment.database.prepare("PRAGMA table_info(guest_checkout_sessions)").all().map((column) => String(column.name));
    assert.ok(columns.includes("checkout_url"), "the store adds the column when a database lacks it");
    assert.equal(fixture.environment.interactionStore.findCheckoutSession(first.checkoutId)?.checkoutUrl, undefined, "a row from before the column has no address");

    fixture = freshProcess(fixture);
    const again = await continueOn(fixture, offerId);
    assert.deepEqual(initializeReferences(fake.requests), [first.pspReference, first.pspReference], "without a stored address the follow initializes again, for the same reference");
    assert.equal(again.checkoutUrl, checkoutFor(first.pspReference), "the address it returns is the one Paystack just issued");
  } finally { fixture.close(); }
});

test("A remint (new reference) initializes Paystack again and stores the new address; the old address is never used again", async () => {
  const fake = fakeWithCheckouts();
  const switchable = switchableFetcher(fake);
  const h = harness("g-d1c6600103", switchable.fetcher);
  let fixture = h.f;
  try {
    const { offerId } = await startRefusedCheckout(h, switchable);
    // A row a previous build wrote: the legacy underscore reference, no provider environment (Paystack never bound it), and an
    // address left over from before the reference changed. Paystack never accepted this attempt, so the address must not survive.
    fixture.environment.database.exec(`UPDATE guest_checkout_sessions SET psp_reference = '${LEGACY_REFERENCE}', provider_environment = NULL, checkout_url = 'https://checkout.paystack.com/${TOKEN}old-legacy' WHERE offer_id = '${offerId}'`);

    fixture = freshProcess(fixture);
    assert.ok(!(fixture.environment.cardPaymentApp.getCheckoutSession(offerId)?.checkoutUrl ?? "").includes("old-legacy"), "the old address is not offered for an attempt Paystack never bound");

    switchable.state.accepting = true;
    const remint = await continueOn(fixture, offerId);
    assert.notEqual(remint.pspReference, LEGACY_REFERENCE, "the legacy reference is replaced");
    assert.match(remint.pspReference, CONFORMING, "the replacement reference is conforming");
    assert.equal(remint.checkoutUrl, checkoutFor(remint.pspReference), "the replacement initialization returns its own address");
    assert.equal(switchable.attempts.at(-1), remint.pspReference, "the last initialization carries the replacement reference");
    assert.ok(!switchable.attempts.includes(LEGACY_REFERENCE), "the legacy reference is never sent to Paystack");
    assert.equal(fixture.environment.interactionStore.findCheckoutSession(remint.checkoutId)?.checkoutUrl, remint.checkoutUrl, "the durable row now holds the new address");
    assert.ok(!(fixture.environment.interactionStore.findCheckoutSession(remint.checkoutId)?.checkoutUrl ?? "").includes("old-legacy"), "the old address is gone from the durable row");

    fixture = freshProcess(fixture);
    const reused = await continueOn(fixture, offerId);
    assert.equal(reused.checkoutUrl, remint.checkoutUrl, "the next follow reuses the new address");
    assert.equal(switchable.attempts.length, 2, "the next follow makes no provider call: one refusal and one replacement in total");
  } finally { fixture.close(); }
});

test("After the Payment Window closes, /continue does not redirect to the stored address (the existing expiry behaviour holds)", async () => {
  const fake = fakeWithCheckouts();
  const h = harness("g-d1c6600104", fake.fetcher);
  let fixture = h.f;
  try {
    const { offerId } = await handoffAfterEmailSave(h);
    const first = await continueOn(fixture, offerId);
    h.clock.now = new Date(Date.parse(first.expiresAt) + 1000);

    fixture = freshProcess(fixture);
    await assert.rejects(() => continueOn(fixture, offerId), /Payment window has expired/, "a closed Payment Window refuses the continuation");
    assert.deepEqual(initializeReferences(fake.requests), [first.pspReference], "no provider call is made after the deadline (ADR 0044)");
  } finally { fixture.close(); }
});

test("AC4 at the route: a closed Payment Window answers /continue with the closed reason and no redirect", async () => {
  const fake = createPaystackHttpFake({ authorizationUrl: checkoutFor });
  const fixture = await restartFixture({}, { paystackClient: new DirectPaystackClient(PAYSTACK_CONFIG, fake.fetcher) });
  try {
    await fixture.advance("payment-ready");
    const offerPath = offerPathOf(await fixture.state());
    const first = await followContinue(fixture, offerPath);
    assert.equal(first.status, 303, "the attempt starts inside the window");
    const session = fixture.environment.cardPaymentApp.getCheckoutSession(decodeURIComponent(offerPath.split("/").at(-1)!));
    assert.ok(session, "the checkout session exists");
    fixture.setTime(new Date(Date.parse(session.expiresAt) + 1000).toISOString());
    await fixture.restart();

    const closed = await followContinue(fixture, offerPath);
    assert.equal(closed.status, 400, "a closed window is refused");
    assert.match(closed.body, /PAYMENT_CONTINUATION_REJECTED/, "the page carries the closed continuation code");
    assert.equal(closed.location, null, "there is no redirect to the stored address");
    assert.equal(initializeReferences(fake.requests).length, 1, "no provider call after the deadline");
  } finally { await fixture.close(); }
});

test("A stored address on another host, another scheme or the wrong provider environment is not used (fail closed: initialize again)", async () => {
  const cases = [
    { label: "another host", address: "https://evil.example.test/co-66-planted", environment: "test" },
    { label: "another scheme", address: `http://checkout.paystack.com/${TOKEN}planted`, environment: "test" },
    { label: "the wrong provider environment", address: `https://checkout.paystack.com/${TOKEN}planted`, environment: "live" },
    { label: "no recorded provider environment", address: `https://checkout.paystack.com/${TOKEN}planted`, environment: null },
  ] as const;
  for (const [index, scenario] of cases.entries()) {
    const fake = fakeWithCheckouts();
    const h = harness(`g-d1c660010${5 + index}`, fake.fetcher);
    let fixture = h.f;
    try {
      const { offerId } = await handoffAfterEmailSave(h);
      const first = await continueOn(fixture, offerId);
      const environment = scenario.environment === null ? "NULL" : `'${scenario.environment}'`;
      fixture.environment.database.exec(`UPDATE guest_checkout_sessions SET checkout_url = '${scenario.address}', provider_environment = ${environment} WHERE offer_id = '${offerId}'`);

      fixture = freshProcess(fixture);
      const again = await continueOn(fixture, offerId);
      assert.deepEqual(initializeReferences(fake.requests), [first.pspReference, first.pspReference], `${scenario.label}: Paystack is initialized again for the same attempt`);
      assert.equal(again.checkoutUrl, checkoutFor(first.pspReference), `${scenario.label}: the address returned is the one Paystack just issued`);
      assert.notEqual(again.checkoutUrl, scenario.address, `${scenario.label}: the planted address is never used`);
    } finally { fixture.close(); }
  }
});

test("The address appears in no log line, audit record, timeline entry or guest response body", async () => {
  const fake = fakeWithCheckouts();
  const h = harness("g-d1c6600111", fake.fetcher);
  let fixture = h.f;
  const logged: string[] = [];
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const sink = (...args: unknown[]) => { logged.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg) ?? String(arg))).join(" ")); };
  console.log = sink; console.info = sink; console.warn = sink; console.error = sink; console.debug = sink;
  try {
    const { result, offerId } = await handoffAfterEmailSave(h);
    await continueOn(fixture, offerId);
    fixture = freshProcess(fixture);
    await continueOn(fixture, offerId);
    fixture = freshProcess(fixture);
    const state = fixture.app.getState(h.threadId);
    const responses = JSON.stringify({ result, state });
    assert.doesNotMatch(responses, new RegExp(TOKEN), "no guest response body carries the address");
    assert.doesNotMatch(databaseTextWithoutAddress(fixture.environment.database), new RegExp(TOKEN), "no table (audit, timeline, thread or snapshot) carries the address");
    assert.doesNotMatch(logged.join("\n"), new RegExp(TOKEN), "no log line carries the address");
    // The migration export and its checksums read the same columns as the daily export (EXPORT_EXCLUDED_COLUMNS, ADR 0096).
    const migrationExport = await buildExport(fixture.environment.database);
    const checkoutRows = migrationExport.contents.guest_checkout_sessions ?? "";
    assert.ok(checkoutRows.includes(offerId), "the migration export carries the session rows");
    assert.doesNotMatch(checkoutRows, new RegExp(TOKEN), "the migration export leaves the address out");
    assert.doesNotMatch(checkoutRows, /checkout_url/, "and its column");
  } finally {
    console.log = original.log; console.info = original.info; console.warn = original.warn; console.error = original.error; console.debug = original.debug;
    fixture.close();
  }
});

test("An attempt that has ended (verified, failed, expired or superseded) never reuses a stored address", async () => {
  const fake = fakeWithCheckouts();
  const h = harness("g-d1c6600112", fake.fetcher);
  let fixture = h.f;
  try {
    const { offerId } = await handoffAfterEmailSave(h);
    const first = await continueOn(fixture, offerId);
    // The attempt leaves the initiated state (here: completed by a verified payment). Its row may still hold the address.
    fixture.environment.database.exec(`UPDATE guest_checkout_sessions SET status = 'completed' WHERE offer_id = '${offerId}'`);
    fixture = freshProcess(fixture);
    const ended = fixture.environment.cardPaymentApp.getCheckoutSession(offerId);
    assert.equal(ended?.status, "completed", "the attempt has ended");
    assert.notEqual(ended?.checkoutUrl, first.checkoutUrl, "the ended attempt exposes no stored address");
    const continued = await continueOn(fixture, offerId).then((session) => session.checkoutUrl, () => undefined);
    assert.notEqual(continued, first.checkoutUrl, "continuing an ended attempt never redirects to its stored address");
  } finally { fixture.close(); }
});

test("AC6 at the route: the guest's state and the redirect page carry no address after a restore", async () => {
  const fake = createPaystackHttpFake({ authorizationUrl: checkoutFor });
  const fixture = await restartFixture({}, { paystackClient: new DirectPaystackClient(PAYSTACK_CONFIG, fake.fetcher) });
  try {
    await fixture.advance("payment-ready");
    const offerPath = offerPathOf(await fixture.state());
    await followContinue(fixture, offerPath);
    await fixture.restart();
    const restored = await followContinue(fixture, offerPath);
    assert.equal(restored.status, 303, "the restored follow redirects");
    assert.doesNotMatch(restored.body, new RegExp(TOKEN), "the redirect response carries no address in its body");
    assert.doesNotMatch(JSON.stringify(await fixture.state()), new RegExp(TOKEN), "the restored state carries no address");
  } finally { await fixture.close(); }
});
