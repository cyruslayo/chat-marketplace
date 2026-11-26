import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CancellationNoShowManager,
  SqliteBookingStateRepository,
  SqliteCancellationCaseRepository,
} from "../domains/shortlet/src/index.js";
import { SqliteOwnerPayableLedger } from "../domains/shortlet/src/owner-payable.js";
import {
  CancellationApplication,
  recordedCancellationRefundPort,
  recordedDepositRefundPort,
} from "../apps/web/src/cancellation-application.js";
import { SHORTLET_SCHEMA_MIGRATIONS, SHORTLET_SCHEMA_VERSION } from "../apps/cloudflare/src/schema.js";
import { SHORTLET_EXPORT_TABLES } from "../apps/cloudflare/src/do-export.js";
import { NodeSqliteDatabase, openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import type { CommandPrincipal } from "../packages/platform-core/src/index.js";
import { createBookingFixture } from "./helpers/booking-state-fixture.js";
import { startSignedInOperator } from "./helpers/operator-session.js";
import { cookieOf, principal as operatorPrincipalOf, reservation as createConfirmedBackOfficeReservation } from "./helpers/back-office-reservation.js";
import { operatorGet, operatorPost } from "./helpers/operator-session.js";
import { lagosCalendarDate } from "../apps/local-owner/src/local-owner-environment.js";
import { visibleText } from "./helpers/back-office-page.js";

const guest: CommandPrincipal = { id: "g1", role: "guest", tenantId: "t1" };
const otherGuest: CommandPrincipal = { id: "g-other", role: "guest", tenantId: "t1" };
const staff: CommandPrincipal = { id: "staff-1", role: "authorized_staff", tenantId: "t1" };
const otherTenantStaff: CommandPrincipal = { id: "staff-2", role: "authorized_staff", tenantId: "t-other" };
const missingTenantStaff: CommandPrincipal = { id: "staff-3", role: "authorized_staff" };
const NOW = new Date("2026-08-10T10:00:00Z");
const clock = () => NOW;

function buildApp(options: {
  readonly db?: NodeSqliteDatabase;
  readonly depositKobo?: number;
  readonly cancellationBaseKobo?: number;
  readonly refundableCleaningKobo?: number;
  readonly refundableSecurityDepositKobo?: number;
  readonly failLedger?: boolean;
  readonly failRelease?: boolean;
  readonly failRefund?: boolean;
  readonly failDepositRefund?: boolean;
  readonly onRelease?: (appRef: { app?: CancellationApplication }) => void;
} = {}) {
  const database = options.db ?? new NodeSqliteDatabase(":memory:");
  const fixture = createBookingFixture({
    dates: { checkIn: "2026-08-20", checkOut: "2026-08-25", nights: 5 },
    quote: {
      allInStayTotalKobo: 50000,
      refundableSecurityDepositKobo: options.depositKobo ?? 10000,
      currency: "NGN",
    },
    totalAmountDueNowKobo: 50000 + (options.depositKobo ?? 10000),
    paymentDetails: {
      paymentMethod: "fresh_card",
      pspReference: "psp-secret-card-ref-1",
      amountKobo: 50000,
      currency: "NGN",
      paidAt: "2026-08-01T00:00:00Z",
    },
  });
  if ((options.depositKobo ?? 10000) > 0) {
    fixture.contract = {
      ...fixture.contract,
      securityDeposit: {
        policyVersion: "dep-v1",
        amountKobo: options.depositKobo ?? 10000,
        currency: "NGN",
        collectionId: "col-1",
        status: "held",
      },
    };
  }
  const state = new SqliteBookingStateRepository(database);
  if (!state.findReservationById(fixture.reservation.reservationId)) {
    state.saveBookingAtomically(fixture);
  }
  const cases = new SqliteCancellationCaseRepository(database, clock);
  const ledgerStore = new SqliteOwnerPayableLedger(database, clock);
  const calls: string[] = [];
  const stateFlags = {
    failLedger: options.failLedger ?? false,
    failRelease: options.failRelease ?? false,
    failRefund: options.failRefund ?? false,
    failDepositRefund: options.failDepositRefund ?? false,
  };
  const appRef: { app?: CancellationApplication } = {};

  const app = new CancellationApplication({
    state,
    cases,
    manager: new CancellationNoShowManager(),
    clock,
    timing: { getWindow: () => ({ startIso: "2026-08-20T13:00:00.000Z", timezone: "Africa/Lagos" }) },
    economics: {
      getEconomics: () => ({
        version: "e1",
        currency: "NGN",
        cancellationBaseKobo: options.cancellationBaseKobo ?? 40000,
        refundableCleaningKobo: options.refundableCleaningKobo ?? 5000,
        refundableUnprovidedServicesKobo: 0,
        refundableSecurityDepositKobo: options.refundableSecurityDepositKobo ?? (options.depositKobo ?? 10000),
        refundableAttributableTaxKobo: 0,
        refundableDuplicatePaymentKobo: 0,
        commissionRate: 0.12,
      }),
    },
    arrival: { getState: () => ({ status: "awaiting_access", version: "a1" }) },
    refunds: {
      initiateOrGetRefund: (input) => {
        calls.push(`refund:${input.amountKobo}`);
        if (stateFlags.failRefund) throw new Error("refund down");
        return recordedCancellationRefundPort(ledgerStore).initiateOrGetRefund(input);
      },
    },
    depositRefunds: {
      initiateOrGetRefund: (input) => {
        calls.push(`depositRefund:${input.amountKobo}`);
        if (stateFlags.failDepositRefund) throw new Error("deposit refund down");
        return recordedDepositRefundPort().initiateOrGetRefund(input);
      },
    },
    ledger: {
      postCancellation: (input) => {
        calls.push(`ledger:${input.amountKobo}`);
        if (stateFlags.failLedger) throw new Error("ledger down");
        return ledgerStore.postCancellation(input);
      },
    },
    availability: {
      releaseConfirmedBooking: () => {
        calls.push("release");
        options.onRelease?.(appRef);
        if (stateFlags.failRelease) throw new Error("release down");
      },
    },
  });
  appRef.app = app;
  return { database, state, cases, ledgerStore, app, calls, stateFlags };
}

test("AC1: For every combination of one failure in ledger, dates, stay refund and deposit refund, resuming reaches ledger posted, dates released, and each refund settled or an open staff item — and D4/D28 P2 shows cancellation refunds on Operator Home until staff record the Paystack reference", async () => {
  // Independent step check: a failed ledger does not stop dates release, stay refund, or deposit refund.
  const world = buildApp({ failLedger: true });
  try {
    const initial = world.app.cancel("r1", guest);
    assert.equal(initial.facts.reservationStatus, "cancelled");
    assert.equal(initial.facts.case?.ledgerStatus, "reconciliation_required");
    assert.equal(initial.facts.case?.inventoryReleaseStatus, "released");
    assert.equal(initial.facts.case?.refundStatus, "pending");
    assert.equal(initial.facts.case?.depositRefundStatus, "pending");
    assert.equal(initial.facts.refunds?.stay.amountKobo, 45000);
    assert.equal(initial.facts.refunds?.stay.status, "pending");
    assert.equal(initial.facts.refunds?.deposit.amountKobo, 10000);
    assert.equal(initial.facts.refunds?.deposit.status, "pending");
    assert.equal(initial.facts.dates?.checkIn, "2026-08-20");
    assert.equal(initial.facts.dates?.checkOut, "2026-08-25");

    // Read retry (D4): getArtifact retries unfinished ledger without repeating release/refunds.
    world.stateFlags.failLedger = false;
    world.calls.length = 0;
    const afterRead = world.app.getArtifact("r1", guest);
    assert.equal(afterRead.facts.case?.ledgerStatus, "posted");
    assert.deepEqual(world.calls, ["ledger:45000"]);
  } finally {
    world.database.close();
  }

  // Operator Home D4 / D28 P2: cancelled Reservation with refund owed appears on Operator Home until staff record refund reference.
  const f = await startSignedInOperator();
  try {
    const requestId = await createConfirmedBackOfficeReservation(f, "2026-09-20", "2026-09-23");
    const env = f.server.environment;
    const opPrincipal = operatorPrincipalOf(f);
    const booking = env.operatorReservation(requestId, opPrincipal);
    const cancelApp = new CancellationApplication({
      state: env.bookingStateRepository,
      cases: env.cancellationCases,
      manager: new CancellationNoShowManager(),
      clock: f.now,
      timing: { getWindow: () => ({ startIso: "2026-09-20T13:00:00.000Z", timezone: "Africa/Lagos" }) },
      economics: {
        getEconomics: () => ({
          version: "e-op",
          currency: "NGN",
          cancellationBaseKobo: booking.amountPaidKobo,
          refundableCleaningKobo: 0,
          refundableUnprovidedServicesKobo: 0,
          refundableSecurityDepositKobo: 0,
          refundableAttributableTaxKobo: 0,
          refundableDuplicatePaymentKobo: 0,
          commissionRate: 0.1,
        }),
      },
      arrival: { getState: () => ({ status: "awaiting_access", version: "a1" }) },
      refunds: recordedCancellationRefundPort(env.ownerPayableLedger),
      ledger: env.ownerPayableLedger,
      availability: { releaseConfirmedBooking: () => {} },
    });

    const contract = env.bookingStateRepository.findContractById(
      env.bookingStateRepository.findReservationById(booking.reservationId)!.contractId,
    )!;
    const guestActor: CommandPrincipal = {
      id: contract.parties.primaryGuest.id,
      role: "guest",
      tenantId: contract.tenantId,
    };
    const cancelled = cancelApp.cancel(booking.reservationId, guestActor);
    assert.equal(cancelled.facts.reservationStatus, "cancelled");
    assert.equal(cancelled.facts.case?.refundStatus, "pending");

    const owedList = env.listGuestRefundsOwed(opPrincipal);
    assert.equal(owedList.some((item) => item.requestId === requestId && item.stayOutcome?.refundKobo === booking.amountPaidKobo), true);

    const homeBefore = await (await operatorGet(f.session, "/operator", cookieOf(f))).text();
    assert.match(homeBefore, /data-kind="guest_refund"/);
    assert.match(visibleText(homeBefore), /Refund owed to the Guest/);

    const bookingPage = await (await operatorGet(f.session, `/operator/bookings/${encodeURIComponent(requestId)}`, cookieOf(f))).text();
    const version = bookingPage.match(/action="\/operator\/bookings\/[^"]+\/guest-refund"[\s\S]*?name="basedOnVersion" value="([^"]+)"/)?.[1];
    assert.ok(version);

    const recorded = await operatorPost(
      f.session,
      `/operator/bookings/${encodeURIComponent(requestId)}/guest-refund`,
      cookieOf(f),
      {},
      {
        basedOnVersion: version,
        amount: String(booking.amountPaidKobo / 100),
        refundedOn: lagosCalendarDate(f.now()),
        reference: "PAYSTACK-RF-001",
      },
    );
    assert.equal(recorded.status, 303);
    assert.equal(env.listGuestRefundsOwed(opPrincipal).length, 0);
    assert.equal(env.cancellationCases.findByReservationId(booking.reservationId)?.refundStatus, "settled");
    const homeAfter = await (await operatorGet(f.session, "/operator", cookieOf(f))).text();
    assert.doesNotMatch(homeAfter, /data-kind="guest_refund"/);
  } finally {
    await f.close();
  }
});

test("AC2: Resuming a finished case changes nothing and calls no port", () => {
  const world = buildApp();
  try {
    const done = world.app.cancel("r1", guest);
    const versionBefore = done.facts.case?.caseVersion;
    assert.equal(done.facts.case?.ledgerStatus, "posted");
    assert.equal(done.facts.case?.inventoryReleaseStatus, "released");
    assert.equal(done.facts.case?.refundStatus, "pending");
    assert.equal(done.facts.case?.depositRefundStatus, "pending");

    world.calls.length = 0;
    const afterResume = world.app.resumeCancellation("r1", staff);
    assert.equal(world.calls.length, 0);
    assert.equal(afterResume.facts.case?.caseVersion, versionBefore);
  } finally {
    world.database.close();
  }
});

test("AC3: Two resumes at once release the dates once and record each refund once", () => {
  // 1) Re-entrant resume on the same CancellationApplication during releaseConfirmedBooking.
  const sameInstance = buildApp({
    failRelease: true,
    failRefund: true,
    failDepositRefund: true,
    onRelease: ({ app }) => {
      if (!sameInstance.stateFlags.failRelease) {
        app?.resumeCancellation("r1", staff);
      }
    },
  });
  try {
    sameInstance.app.cancel("r1", guest);
    sameInstance.stateFlags.failRelease = false;
    sameInstance.stateFlags.failRefund = false;
    sameInstance.stateFlags.failDepositRefund = false;
    sameInstance.calls.length = 0;

    const resumed = sameInstance.app.resumeCancellation("r1", staff);
    assert.equal(resumed.facts.case?.inventoryReleaseStatus, "released");
    assert.equal(resumed.facts.case?.refundStatus, "pending");
    assert.equal(resumed.facts.case?.depositRefundStatus, "pending");
    assert.deepEqual(sameInstance.calls, ["release", "refund:45000", "depositRefund:10000"]);
  } finally {
    sameInstance.database.close();
  }

  // 2) Two separate CancellationApplication instances sharing one SqlDatabase (WeakMap guard).
  const sharedDb = new NodeSqliteDatabase(":memory:");
  let secondApp: CancellationApplication | undefined;
  const first = buildApp({
    db: sharedDb,
    failRelease: true,
    failRefund: true,
    failDepositRefund: true,
    onRelease: () => {
      if (!first.stateFlags.failRelease) {
        secondApp?.resumeCancellation("r1", staff);
      }
    },
  });
  const second = buildApp({ db: sharedDb });
  secondApp = second.app;
  try {
    first.app.cancel("r1", guest);
    first.stateFlags.failRelease = false;
    first.stateFlags.failRefund = false;
    first.stateFlags.failDepositRefund = false;
    first.calls.length = 0;
    second.calls.length = 0;

    first.app.resumeCancellation("r1", staff);
    assert.deepEqual(first.calls, ["release", "refund:45000", "depositRefund:10000"]);
    assert.deepEqual(second.calls, []);
  } finally {
    sharedDb.close();
  }
});

test("AC4: The sum of refunds never exceeds the sum paid, and the deposit is never added to the stay refund", () => {
  const separated = buildApp({
    depositKobo: 15000,
    cancellationBaseKobo: 40000,
    refundableCleaningKobo: 5000,
    refundableSecurityDepositKobo: 15000,
  });
  try {
    const artifact = separated.app.cancel("r1", guest);
    assert.equal(artifact.facts.refunds?.stay.amountKobo, 45000);
    assert.equal(artifact.facts.refunds?.deposit.amountKobo, 15000);
    assert.ok(45000 + 15000 <= 50000 + 15000);
  } finally {
    separated.database.close();
  }

  const excessive = buildApp({
    depositKobo: 0,
    cancellationBaseKobo: 60000,
    refundableCleaningKobo: 0,
    refundableSecurityDepositKobo: 0,
  });
  try {
    assert.throws(() => excessive.app.cancel("r1", guest), /exceeds total stay amount paid/);
    assert.equal(excessive.state.findReservationById("r1")?.status, "confirmed");
    assert.equal(excessive.calls.length, 0);
  } finally {
    excessive.database.close();
  }
});

test("AC5: The case survives a restart and is in the daily export", () => {
  const dir = mkdtempSync(join(tmpdir(), "cancellation-case-restart-"));
  const dbPath = join(dir, "restart.sqlite");
  try {
    const db1 = openNodeSqliteDatabase(dbPath);
    const first = buildApp({ db: db1, failRefund: true });
    first.app.cancel("r1", guest);
    assert.equal(first.cases.findByReservationId("r1")?.refundStatus, "failed");
    db1.close();

    // Reopen fresh instances from disk.
    const db2 = openNodeSqliteDatabase(dbPath);
    const second = buildApp({ db: db2 });
    const loaded = second.cases.findByReservationId("r1");
    assert.ok(loaded);
    assert.equal(loaded.refundStatus, "failed");
    assert.equal(loaded.inventoryReleaseStatus, "released");
    assert.equal(loaded.ledgerStatus, "posted");

    // Raw payment references never enter cancellation_cases (ADR 0075).
    const rawRow = db2.prepare("SELECT case_json FROM cancellation_cases WHERE reservation_id = 'r1'").get() as { case_json: string };
    assert.equal(rawRow.case_json.includes("psp-secret-card-ref-1"), false);

    const resumed = second.app.resumeCancellation("r1", staff);
    assert.equal(resumed.facts.case?.refundStatus, "pending");
    db2.close();

    // Schema migration v6 and daily export table list both include cancellation_cases.
    const migrationStatements = SHORTLET_SCHEMA_MIGRATIONS.flatMap((m) => m.statements).join("\n");
    assert.equal(SHORTLET_SCHEMA_VERSION >= 6, true);
    assert.match(migrationStatements, /CREATE TABLE IF NOT EXISTS cancellation_cases/i);
    assert.equal(SHORTLET_EXPORT_TABLES.includes("cancellation_cases"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6: A guest of another Reservation, a missing tenant, and a guest calling resume are refused", () => {
  const world = buildApp({ failRefund: true });
  try {
    assert.throws(() => world.app.getArtifact("r1", otherGuest), /Access denied/);
    assert.throws(() => world.app.cancel("r1", otherGuest), /Access denied/);
    assert.throws(() => world.app.getArtifact("r1", missingTenantStaff), /Access denied/);

    world.app.cancel("r1", guest);

    assert.throws(() => world.app.resumeCancellation("r1", guest), /Authorized staff or system principal is required/);
    assert.throws(() => world.app.resumeCancellation("r1", otherGuest), /Authorized staff or system principal is required/);
    assert.throws(() => world.app.resumeCancellation("r1", otherTenantStaff), /Access denied/);
    assert.throws(() => world.app.resumeCancellation("r1", missingTenantStaff), /Access denied/);
  } finally {
    world.database.close();
  }
});
