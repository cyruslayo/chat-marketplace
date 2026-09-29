import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { SqliteGuestContactRepository, SqliteGuestInteractionStore, type DurableBookingRequest } from "../domains/shortlet/src/index.js";
import { PilotNotifier } from "../apps/pilot/src/notifications/pilot-notifier.js";
import { EmailProviderError, RESEND_EMAILS_ENDPOINT, ResendEmailSender, type EmailMessage, type EmailSender } from "../apps/pilot/src/notifications/email-sender.js";
import { notificationConfiguration } from "../apps/pilot/src/pilot-config.js";
import { productionPilotStartupLines } from "../apps/pilot/src/startup-banner.js";
import { startPilotServer } from "../apps/pilot/src/pilot-server.js";
import { productionFixture } from "./helpers/pilot-fixture.js";

// Launch-readiness issue 23: Operator and Guest email notifications.

const ORIGIN = "https://pilot.example.com";
const OPS = ["ops@shortlet.example"];
const GUEST_EMAIL = "guest@example.com";
const DISCLOSED_AT = new Date("2026-10-10T09:00:00.000Z");
const minutes = (count: number) => new Date(DISCLOSED_AT.getTime() + count * 60_000);

class RecordingSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failWith: Error | null = null;
  async send(message: EmailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
  }
  subjects(): string[] {
    return this.sent.map((message) => message.subject);
  }
}

interface Harness {
  readonly store: SqliteGuestInteractionStore;
  readonly contacts: SqliteGuestContactRepository;
  readonly sender: RecordingSender;
  readonly notifier: PilotNotifier;
  readonly logs: string[];
  setNow(at: Date): void;
  close(): Promise<void>;
}

async function harness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "shortlet-notifications-"));
  const databasePath = join(directory, "pilot.sqlite");
  const database = new DatabaseSync(databasePath);
  const store = new SqliteGuestInteractionStore(databasePath, database);
  const contacts = new SqliteGuestContactRepository(database);
  const sender = new RecordingSender();
  const logs: string[] = [];
  let now = DISCLOSED_AT;
  const notifier = new PilotNotifier({
    databasePath,
    publicOrigin: ORIGIN,
    sender,
    operatorAlertEmails: OPS,
    unitTitle: (unitId) => (unitId === "unit-1" ? "Serene One-Bedroom Suite in Lekki Phase 1" : "your apartment"),
    clock: () => now,
    log: (line) => logs.push(line),
  });
  return {
    store,
    contacts,
    sender,
    notifier,
    logs,
    setNow: (at) => { now = at; },
    close: async () => {
      notifier.close();
      database.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function bookingRequest(overrides: Partial<DurableBookingRequest> = {}): DurableBookingRequest {
  return {
    requestId: "req-1",
    draftId: "draft-1",
    unitId: "unit-1",
    tenantId: "tenant-pilot",
    operatorId: "op-1",
    primaryGuestId: "guest-1",
    primaryGuestName: "Ada Obi",
    occupants: ["Ada Obi", "Tunde Obi"],
    checkIn: "2026-10-20",
    checkOut: "2026-10-22",
    nights: 2,
    quoteJson: JSON.stringify({ allInStayTotalKobo: 12_500_000 }),
    inventoryCommitmentId: "commit-1",
    disclosedAt: DISCLOSED_AT.toISOString(),
    deliveryDeadlineAt: minutes(5).toISOString(),
    operatorResponseDeadlineAt: minutes(30).toISOString(),
    delivered: true,
    deliveredAt: DISCLOSED_AT.toISOString(),
    status: "disclosed",
    confirmedAt: null,
    declinedAt: null,
    declineReason: null,
    phoneNumber: "+2348011111111",
    ...overrides,
  };
}

test("The Operator is notified when a Booking Request is disclosed", async () => {
  const h = await harness();
  try {
    h.store.saveBookingRequest(bookingRequest());
    const first = await h.notifier.sweep();
    const alert = h.sender.sent.find((message) => message.to.includes(OPS[0]!));
    assert.ok(alert, "an Operator alert was sent");
    assert.match(alert.subject, /^New Booking Request: Serene One-Bedroom Suite in Lekki Phase 1, respond by /);
    assert.match(alert.text, /Guests: 2/);
    assert.match(alert.text, /All-In Stay Total: /);
    assert.match(alert.text, /https:\/\/pilot\.example\.com\/operator\/requests\/req-1/);
    // ADR 0075: no guest name or phone number in email.
    assert.doesNotMatch(`${alert.subject}\n${alert.text}`, /Ada|Tunde|\+234/);
    assert.equal(alert.idempotencyKey, "operator.request_received:req-1");
    assert.equal(first.sent, 1, "the Guest has no email yet, so only the Operator alert is sent");

    await h.notifier.sweep();
    assert.equal(h.sender.sent.filter((message) => message.to.includes(OPS[0]!)).length, 1, "sent once, however many sweeps run");

    // Undelivered, already-answered or old requests do not raise a new-request alert.
    h.store.saveBookingRequest(bookingRequest({ requestId: "req-undelivered", delivered: false, deliveredAt: null }));
    h.store.saveBookingRequest(bookingRequest({ requestId: "req-confirmed", status: "confirmed", confirmedAt: minutes(1).toISOString() }));
    h.store.saveBookingRequest(bookingRequest({ requestId: "req-old", disclosedAt: new Date(DISCLOSED_AT.getTime() - 2 * 86_400_000).toISOString() }));
    await h.notifier.sweep();
    assert.deepEqual(h.sender.sent.filter((message) => message.to.includes(OPS[0]!)).map((message) => message.idempotencyKey), ["operator.request_received:req-1"]);
  } finally {
    await h.close();
  }
});

test("The Operator is reminded before the response window closes", async () => {
  const h = await harness();
  try {
    h.store.saveBookingRequest(bookingRequest());
    await h.notifier.sweep();
    h.setNow(minutes(9));
    await h.notifier.sweep();
    assert.equal(h.sender.subjects().filter((subject) => subject.includes("eminder")).length, 0, "no reminder before minute 10");

    h.setNow(minutes(10));
    await h.notifier.sweep();
    h.setNow(minutes(12));
    await h.notifier.sweep();
    h.setNow(minutes(25));
    await h.notifier.sweep();
    const reminders = h.sender.sent.filter((message) => message.idempotencyKey.startsWith("operator.response_reminder:"));
    assert.deepEqual(reminders.map((message) => message.idempotencyKey), ["operator.response_reminder:req-1:10", "operator.response_reminder:req-1:25"]);
    assert.match(reminders[0]!.subject, /^Reminder: 20 minutes left to answer Serene/);
    assert.match(reminders[1]!.subject, /^Final reminder: 5 minutes left to answer Serene/);
    assert.deepEqual(reminders[1]!.to, OPS);

    // No reminder once the request is answered, or once the deadline has passed.
    h.store.saveBookingRequest(bookingRequest({ requestId: "req-answered", status: "declined", declinedAt: minutes(11).toISOString() }));
    h.store.saveBookingRequest(bookingRequest({ requestId: "req-late", disclosedAt: minutes(-40).toISOString(), operatorResponseDeadlineAt: minutes(-10).toISOString() }));
    h.setNow(minutes(26));
    await h.notifier.sweep();
    assert.equal(h.sender.sent.filter((message) => /response_reminder:req-(answered|late)/.test(message.idempotencyKey)).length, 0);
  } finally {
    await h.close();
  }
});

test("The Guest is notified when a request is submitted, an offer is made, payment is confirmed, and a request expires or is declined", async () => {
  const h = await harness();
  try {
    h.contacts.saveEmail({ guestId: "guest-1", tenantId: "tenant-pilot", contactEmail: GUEST_EMAIL });
    h.store.saveBookingRequest(bookingRequest());
    await h.notifier.sweep();
    const guestMail = () => h.sender.sent.filter((message) => message.to.includes(GUEST_EMAIL));
    assert.deepEqual(guestMail().map((message) => message.idempotencyKey), ["guest.request_submitted:req-1"]);
    assert.match(guestMail()[0]!.text, /No Reservation exists yet; the Operator must respond by/);

    h.store.saveBookingRequest(bookingRequest({ status: "confirmed", confirmedAt: minutes(3).toISOString() }));
    h.store.saveConditionalOffer({ offerId: "offer-1", requestId: "req-1", inventoryCommitmentId: "commit-1", unitId: "unit-1", tenantId: "tenant-pilot", offerJson: "{}", status: "issued", issuedAt: minutes(3).toISOString(), acceptedAt: null, tokenUsed: false, offerVersion: 1 });
    h.setNow(minutes(4));
    await h.notifier.sweep();
    assert.equal(guestMail().at(-1)!.idempotencyKey, "guest.offer_made:offer-1");
    assert.match(guestMail().at(-1)!.text, /not reserved until payment is confirmed/);

    h.store.saveBookingSnapshot({ reservationId: "res-1", contractId: "contract-1", offerId: "offer-1", reservationJson: "{}", contractJson: "{}", confirmedAt: minutes(8).toISOString() });
    h.setNow(minutes(9));
    await h.notifier.sweep();
    assert.equal(guestMail().at(-1)!.idempotencyKey, "guest.payment_confirmed:res-1");
    assert.match(guestMail().at(-1)!.subject, /^Booking confirmed: Serene/);

    // A declined request, and a request that expires lazily: its stored status is still "disclosed".
    h.contacts.saveEmail({ guestId: "guest-2", tenantId: "tenant-pilot", contactEmail: "second@example.com" });
    h.store.saveBookingRequest(bookingRequest({ requestId: "req-2", primaryGuestId: "guest-2", disclosedAt: minutes(5).toISOString(), status: "declined", declinedAt: minutes(9).toISOString() }));
    h.store.saveBookingRequest(bookingRequest({ requestId: "req-3", primaryGuestId: "guest-2", disclosedAt: minutes(-31).toISOString(), operatorResponseDeadlineAt: minutes(-1).toISOString() }));
    await h.notifier.sweep();
    const second = h.sender.sent.filter((message) => message.to.includes("second@example.com")).map((message) => message.idempotencyKey);
    assert.ok(second.includes("guest.request_declined:req-2"));
    assert.ok(second.includes("guest.request_expired:req-3"));
    assert.equal(h.store.findBookingRequest("req-3")!.status, "disclosed", "the notifier projects expiry without writing it");
    for (const message of h.sender.sent.filter((candidate) => candidate.to.includes("second@example.com") && /declined|expired/.test(candidate.idempotencyKey))) {
      assert.match(message.text, /Nothing was reserved and you have not been charged/);
    }

    // A Guest without an email address is skipped, not retried every sweep.
    h.store.saveBookingRequest(bookingRequest({ requestId: "req-4", primaryGuestId: "guest-no-email" }));
    const report = await h.notifier.sweep();
    assert.equal(report.skipped, 1);
    assert.equal((await h.notifier.sweep()).skipped, 0);
  } finally {
    await h.close();
  }
});

test("A notification failure never changes booking state", async () => {
  const h = await harness();
  try {
    h.contacts.saveEmail({ guestId: "guest-1", tenantId: "tenant-pilot", contactEmail: GUEST_EMAIL });
    h.store.saveBookingRequest(bookingRequest());
    const before = h.store.findBookingRequest("req-1");
    h.sender.failWith = new EmailProviderError(503);
    const failed = await h.notifier.sweep();
    assert.equal(failed.failed, 2);
    assert.equal(failed.sent, 0);
    assert.deepEqual(h.store.findBookingRequest("req-1"), before, "the Booking Request is untouched");
    assert.ok(h.logs.every((line) => !/guest@example|Ada|Serene|\+234/.test(line)), "failure logs carry no personal data");
    assert.deepEqual(JSON.parse(h.logs[0]!), { event: "notification_failed", kind: "operator.request_received", attempts: 1, providerStatus: 503 });

    // The next sweep retries with the same idempotency key; a thrown non-provider error is contained too.
    h.sender.failWith = null;
    const retried = await h.notifier.sweep();
    assert.equal(retried.sent, 2);
    assert.deepEqual(h.sender.sent.map((message) => message.idempotencyKey).sort(), ["guest.request_submitted:req-1", "operator.request_received:req-1"]);

    h.store.saveBookingRequest(bookingRequest({ requestId: "req-5" }));
    h.sender.failWith = new TypeError("unexpected");
    const logsBefore = h.logs.length;
    for (let attempt = 0; attempt < 7; attempt++) await h.notifier.sweep();
    const failures = h.logs.slice(logsBefore).map((line) => JSON.parse(line) as { kind: string; attempts: number });
    // Two notifications (Operator alert and Guest confirmation), each tried five times and then abandoned.
    assert.deepEqual(failures.filter((entry) => entry.kind === "operator.request_received").map((entry) => entry.attempts), [1, 2, 3, 4, 5]);
    assert.deepEqual(failures.filter((entry) => entry.kind === "guest.request_submitted").map((entry) => entry.attempts), [1, 2, 3, 4, 5]);
    assert.equal(h.store.findBookingRequest("req-5")!.status, "disclosed");
  } finally {
    await h.close();
  }
});

test("Resend requests carry the key, sender, recipients and idempotency key, and errors expose only the status", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const sender = new ResendEmailSender({
    apiKey: "re_offline",
    from: "Shortlet <bookings@shortlet.example>",
    fetch: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: "email-1" }), { status: 200 }); },
  });
  await sender.send({ to: OPS, subject: "Subject", text: "Body", idempotencyKey: "operator.request_received:req-1" });
  assert.equal(calls[0]!.url, RESEND_EMAILS_ENDPOINT);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer re_offline");
  assert.equal(headers["Idempotency-Key"], "operator.request_received:req-1");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { from: "Shortlet <bookings@shortlet.example>", to: OPS, subject: "Subject", text: "Body" });

  const rejecting = new ResendEmailSender({ apiKey: "re_offline", from: "bookings@shortlet.example", fetch: async () => new Response(JSON.stringify({ message: "Invalid key re_offline" }), { status: 401 }) });
  await assert.rejects(rejecting.send({ to: OPS, subject: "s", text: "t", idempotencyKey: "k" }), (error: unknown) => error instanceof EmailProviderError && error.status === 401 && !error.message.includes("re_offline"));
  const unreachable = new ResendEmailSender({ apiKey: "re_offline", from: "bookings@shortlet.example", fetch: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(unreachable.send({ to: OPS, subject: "s", text: "t", idempotencyKey: "k" }), (error: unknown) => error instanceof EmailProviderError && error.status === null);

  // Configuration: all three settings or none, with valid addresses; the banner never prints them.
  assert.equal(notificationConfiguration({}), null);
  const configured = notificationConfiguration({ RESEND_API_KEY: "re_x", SHORTLET_NOTIFICATION_FROM: "Shortlet <bookings@shortlet.example>", SHORTLET_OPERATOR_ALERT_EMAILS: "ops@shortlet.example, founder@shortlet.example" });
  assert.deepEqual(configured?.operatorAlertEmails, ["ops@shortlet.example", "founder@shortlet.example"]);
  assert.equal(configured?.sweepSeconds, 30);
  assert.throws(() => notificationConfiguration({ RESEND_API_KEY: "re_x" }), /all be set, or none/);
  assert.throws(() => notificationConfiguration({ RESEND_API_KEY: "re_x", SHORTLET_NOTIFICATION_FROM: "not-an-address", SHORTLET_OPERATOR_ALERT_EMAILS: "ops@shortlet.example" }), /SHORTLET_NOTIFICATION_FROM/);
  assert.throws(() => notificationConfiguration({ RESEND_API_KEY: "re_x", SHORTLET_NOTIFICATION_FROM: "bookings@shortlet.example", SHORTLET_OPERATOR_ALERT_EMAILS: "ops@, other" }), /comma-separated list/);
  const banner = productionPilotStartupLines({ publicOrigin: ORIGIN, paystackEnvironment: "live", port: 3000, notifications: configured }).join("\n");
  assert.match(banner, /notifications=resend operatorAlertRecipients=2/);
  assert.doesNotMatch(banner, /re_x|ops@|founder@/);
  assert.match(productionPilotStartupLines({ publicOrigin: ORIGIN, paystackEnvironment: "live", port: 3000, notifications: null }).join("\n"), /notifications=disabled/);
});

test("The production pilot runs the notifier when notifications are configured", async () => {
  const fixture = await productionFixture({ environment: { RESEND_API_KEY: "re_offline", SHORTLET_NOTIFICATION_FROM: "bookings@shortlet.example", SHORTLET_OPERATOR_ALERT_EMAILS: "ops@shortlet.example", SHORTLET_NOTIFICATION_SWEEP_SECONDS: "1" } });
  const sender = new RecordingSender();
  const server = startPilotServer({ port: 0, configuration: fixture.configuration, paystackClient: fixture.paystack, emailSender: sender });
  try {
    assert.ok(server.notifier);
    await server.listen();
    const store = new SqliteGuestInteractionStore(fixture.configuration.databasePath);
    const now = new Date();
    store.saveBookingRequest(bookingRequest({ unitId: fixture.configuration.unitId, disclosedAt: now.toISOString(), deliveryDeadlineAt: new Date(now.getTime() + 5 * 60_000).toISOString(), operatorResponseDeadlineAt: new Date(now.getTime() + 30 * 60_000).toISOString() }));
    store.close();
    const deadline = Date.now() + 5_000;
    while (sender.sent.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sender.sent[0]?.idempotencyKey, "operator.request_received:req-1");
    assert.doesNotMatch(sender.sent[0]!.subject, /your apartment/, "the real apartment title comes from the inventory");
  } finally {
    await server.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
  const plain = await productionFixture();
  try {
    assert.equal(plain.configuration.notifications, null);
    const server2 = startPilotServer({ port: 0, configuration: plain.configuration, paystackClient: plain.paystack });
    assert.equal(server2.notifier, null);
    await server2.listen();
    await server2.close();
  } finally {
    await rm(plain.directory, { recursive: true, force: true });
  }
});
