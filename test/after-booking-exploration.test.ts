import test from "node:test";
import assert from "node:assert/strict";
import type { ReservationStatus } from "../domains/shortlet/src/index.js";
import type { CancellationCase } from "../apps/web/src/cancellation-application.js";
import {
  afterBookingGuestPrincipal,
  createAfterBookingWorld,
  DEFAULT_AFTER_BOOKING_DEPTH,
  DEFAULT_AFTER_BOOKING_RESUMES,
  runAfterBookingChangeExploration,
  type AfterBookingWorld,
  type AmendmentViolationDetail,
} from "./helpers/booking-state-fixture.js";
import {
  exploreFailures,
  exploreOrders,
  type ExploreFailuresResult,
  type ExploreOrdersResult,
} from "./helpers/explore.js";

interface CancellationEndState {
  readonly reservationStatus: ReservationStatus;
  readonly ledgerStatus: CancellationCase["ledgerStatus"] | null;
  readonly inventoryReleaseStatus: CancellationCase["inventoryReleaseStatus"] | null;
  readonly refundStatus: CancellationCase["refundStatus"] | null;
  readonly depositRefundStatus: CancellationCase["depositRefundStatus"] | null;
  readonly guestActionsLeft: number;
}

function runAfterBookingCancellationFailures(): ExploreFailuresResult<CancellationEndState> {
  return exploreFailures<AfterBookingWorld, CancellationEndState>({
    ports: ["ledger", "release", "refund", "depositRefund"],
    resumes: DEFAULT_AFTER_BOOKING_RESUMES,
    newWorld: (faults) => createAfterBookingWorld({ faults, storage: "file", withDeposit: true }),
    disposeWorld: (w) => w.close(),
    run: (w) => {
      w.cancelApp.cancel("r1", afterBookingGuestPrincipal);
    },
    resume: (w) => {
      w.cancelApp.resumeCancellation("r1", { id: "staff-1", role: "authorized_staff", tenantId: "t1" });
    },
    check: (w) => {
      const artifact = w.cancelApp.getArtifact("r1", afterBookingGuestPrincipal);
      const cancelCase = artifact.facts.case;
      const reservation = w.state.findReservationById("r1");
      const finished =
        cancelCase !== undefined &&
        cancelCase.ledgerStatus === "posted" &&
        cancelCase.inventoryReleaseStatus === "released" &&
        (cancelCase.refundStatus === "pending" || cancelCase.refundStatus === "settled") &&
        (cancelCase.depositRefundStatus === "pending" || cancelCase.depositRefundStatus === "settled");
      if (finished) return null;

      return {
        reason: "Cancellation remained unfinished after 3 retries",
        detail: {
          reservationStatus: reservation?.status ?? "confirmed",
          ledgerStatus: cancelCase?.ledgerStatus ?? null,
          inventoryReleaseStatus: cancelCase?.inventoryReleaseStatus ?? null,
          refundStatus: cancelCase?.refundStatus ?? null,
          depositRefundStatus: cancelCase?.depositRefundStatus ?? null,
          guestActionsLeft: artifact.actions.length,
        },
      };
    },
  });
}

let cachedCheckA: ExploreOrdersResult<AmendmentViolationDetail> | undefined;
let cachedCheckB: ExploreFailuresResult<CancellationEndState> | undefined;

test("AC2 (issue 04): The order check reports zero failing orders on SQLite, with request, accept, cancel and commit each succeeding in at least one order", () => {
  const result = runAfterBookingChangeExploration({
    depth: DEFAULT_AFTER_BOOKING_DEPTH,
    prune: true,
    storage: "file",
  });
  cachedCheckA = result;

  assert.ok(result.explored < 5460, `Expected pruning below 5460, got ${result.explored}`);
  assert.ok(result.pruned > 0);
  assert.equal(result.violations.length, 0);
  assert.equal(result.shortestFailure, null);
  for (const stepName of ["request", "accept", "commit", "cancel"] as const) {
    assert.ok(
      (result.stepSuccessCounts[stepName] ?? 0) > 0,
      `Expected ${stepName} to succeed at least once`,
    );
  }
});

test("AC1 (issue 05): For every combination of one failure in ledger, dates, stay refund and deposit refund, resuming reaches ledger posted, dates released, and each refund settled or an open staff item", () => {
  const result = runAfterBookingCancellationFailures();
  cachedCheckB = result;

  assert.equal(result.explored, 16);
  assert.equal(result.violations.length, 0);
  assert.equal(result.shortestFailure, null);
  for (const portName of ["ledger", "release", "refund", "depositRefund"] as const) {
    assert.ok((result.portSuccessCounts[portName] ?? 0) > 0, `Expected ${portName} to succeed`);
  }
});

test("AC7: The default depth bounds stay deterministic (28 explored for check A, 16 for check B); wider depth runs only from scripts/explore-after-booking.ts, never from npm test", () => {
  const checkA =
    cachedCheckA ??
    runAfterBookingChangeExploration({
      depth: DEFAULT_AFTER_BOOKING_DEPTH,
      prune: true,
      storage: "file",
    });
  const checkB = cachedCheckB ?? runAfterBookingCancellationFailures();

  assert.equal(DEFAULT_AFTER_BOOKING_DEPTH, 6);
  assert.equal(checkA.explored, 28);
  assert.equal(checkA.pruned, 22);
  assert.equal(checkB.explored, 16);
  assert.throws(
    () =>
      exploreOrders({
        steps: [{ name: "noop", run: () => {} }],
        depth: -1,
        prune: false,
        newWorld: () => ({}),
        check: { reads: ["ok"], verify: () => null },
      }),
    /non-negative integer/,
  );
});
