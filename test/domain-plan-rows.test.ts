import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { LocalGuestApp } from "../apps/local-guest/src/shortlet-app.js";
import { GUEST_STAGES, type GuestStage } from "../apps/local-guest/src/guest-stage.js";
import {
  composePlanRows,
  validatePackPlanRows,
  PLAN_ROW_GROUPS,
  type PlanRow,
  type PlanRowsDiagnostic,
} from "../apps/local-guest/src/assistant/plan-rows.js";
import {
  collectStaysPlanEntries,
  planGroupForGuestStage,
} from "../apps/local-guest/src/assistant/shortlet-plan-rows.js";
import type { AssistantDomainPack } from "../apps/local-guest/src/assistant/assistant-platform.js";
import { createShortletAssistantPack } from "../apps/local-guest/src/assistant/shortlet-assistant-pack.js";
import {
  GuestIdentityResolver,
  SqliteGuestAccountAuthority,
  SqliteGuestAccountLinks,
  SqliteGuestInteractionStore,
  type GuestIdentity,
} from "../domains/shortlet/src/index.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import type { CommandPrincipal } from "../packages/platform-core/src/envelope.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { createStubPack } from "./helpers/stub-domain-pack.js";
import {
  coldApp,
  EMAIL,
  JOURNEY_SCRIPT,
  PHONE,
  successOf,
  tap,
  typedTurn,
  type Surface,
} from "./helpers/assistant-stage-journey.js";
import { extendUnit } from "./helpers/demo-extended-journey.js";
import { TEST_GUEST_CODE_HASHING_KEY, signInGuestAccount } from "./helpers/guest-account-authority.js";
import { accountFixture, getPage, signInDevice } from "./helpers/guest-account-sign-in.js";
import { deviceCookies } from "./helpers/guest-account-page.js";
import {
  datedFixture,
  firstButtonAction,
  LIVE_LIKE_CLOCK,
  restartedDatedApp,
  scriptedPlanner,
  trueRestartedDatedApp,
  type DatedFixture,
  type ScriptedTurn,
} from "./helpers/guest-date-fixtures.js";
import { restartFixture } from "./helpers/guest-restart.js";

// Rules 02 (plans list), Issue 10: domain rows contract, stays implementation, cold restore, and 24-cell decision table.
// ADRs: 0004, 0005, 0071, 0074, 0075, 0077, 0093, 0099, 0104, 0106, 0107.

const CLOSED_ROW_KEYS = new Set(["rowId", "domain", "title", "where", "startsOn", "endsOn", "group", "status", "nextStep", "href"]);
const CLOSED_STATUS_KEYS = new Set(["tone", "label"]);
const CLOSED_NEXT_STEP_KEYS = new Set(["label", "deadlineAt"]);

const MULTI_STAY_SCRIPT: Readonly<Record<string, ScriptedTurn>> = {
  ...JOURNEY_SCRIPT,
  "Apartment in Lekki for 2 guests, 3 nights from 18 December 2026": {
    slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-18", nights: 3, guests: 2 },
    search: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-18", nights: 3, guests: 2 },
  },
  "Apartment in Lekki for 2 guests, 3 nights from 22 December 2026": {
    slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-22", nights: 3, guests: 2 },
    search: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-22", nights: 3, guests: 2 },
  },
  "Apartment in Lekki for 2 guests, 3 nights from 26 December 2026": {
    slots: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-26", nights: 3, guests: 2 },
    search: { city: "Lagos", neighbourhood: "Lekki Phase 1", checkIn: "2026-12-26", nights: 3, guests: 2 },
  },
};

function multiStayFixture(): DatedFixture {
  return datedFixture(scriptedPlanner(MULTI_STAY_SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
}

async function driveRequestFor(f: DatedFixture, threadId: string, text: string): Promise<string> {
  const search = successOf(await typedTurn(f, threadId, text, MULTI_STAY_SCRIPT), "search");
  const detail = await tap(f, threadId, search.surfaces[0]!, "View");
  const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
  const afterReview = await tap(f, threadId, draft.surfaces[0]!, "Review request");
  if (afterReview.surfaces[0]!.surfaceId.includes(":contact:phone:")) {
    const phoneSave = firstButtonAction(afterReview.surfaces[0]!);
    const saved = successOf(await coldApp(f, threadId).app.handleEventAsync(threadId, {
      ...phoneSave,
      context: { ...phoneSave.context, contactValue: PHONE },
    }), "Save phone number");
    const sent = await tap(f, threadId, saved.surfaces[0]!, "Send booking request");
    return sent.surfaces[0]!.surfaceId.split(":").at(-1)!;
  }
  const sent = await tap(f, threadId, afterReview.surfaces[0]!, "Send booking request");
  return sent.surfaces[0]!.surfaceId.split(":").at(-1)!;
}

async function driveOfferFor(f: DatedFixture, threadId: string, text: string): Promise<Surface> {
  const requestId = await driveRequestFor(f, threadId, text);
  f.environment.simulateOperatorAcceptance(requestId);
  return coldApp(f, threadId).app.getState(threadId)!.surfaces[0]!;
}

async function drivePaymentFor(f: DatedFixture, threadId: string, text: string): Promise<Surface> {
  const offer = await driveOfferFor(f, threadId, text);
  return (await tap(f, threadId, offer, "Accept offer")).surfaces[0]!;
}

async function driveReservationFor(f: DatedFixture, threadId: string, text: string): Promise<Surface> {
  const payment = await drivePaymentFor(f, threadId, text);
  const checkout = await tap(f, threadId, payment, "Start checkout");
  let readyForReturn = checkout.surfaces[0]!;
  if (readyForReturn.surfaceId.includes(":contact:email:")) {
    const emailAsk = firstButtonAction(readyForReturn);
    const emailSaved = successOf(await coldApp(f, threadId).app.handleEventAsync(threadId, {
      ...emailAsk,
      context: { ...emailAsk.context, contactValue: EMAIL },
    }), "Save email");
    readyForReturn = emailSaved.surfaces[0]!;
  }
  const returned = await tap(f, threadId, readyForReturn, "Payment return");
  const verifying = await tap(f, threadId, returned.surfaces[0]!, "Verify payment");
  return (await tap(f, threadId, verifying.surfaces[0]!, "Confirm payment")).surfaces[0]!;
}

function assertRedactedRowShape(row: PlanRow): void {
  const record = row as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(record).sort(), [...CLOSED_ROW_KEYS].filter((k) => record[k] !== undefined).sort());
  assert.deepEqual(Object.keys(row.status).sort(), [...CLOSED_STATUS_KEYS].sort());
  assert.deepEqual(
    Object.keys(row.nextStep).sort(),
    [...CLOSED_NEXT_STEP_KEYS].filter((k) => (row.nextStep as unknown as Record<string, unknown>)[k] !== undefined).sort(),
  );
  const serialized = JSON.stringify(row);
  assert.doesNotMatch(serialized, /kobo|₦|NGN|\+234|@example\.com|tok_/i, `row ${row.rowId} leaks sensitive pricing, contact, or credential text`);
}

function makeFakeRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    rowId: "shop:order:1",
    domain: "shop",
    title: "Woven throw blanket",
    where: "Victoria Island, Lagos",
    startsOn: "2026-11-10",
    endsOn: "2026-11-10",
    group: "in_progress",
    status: { tone: "info", label: "Preparing order" },
    nextStep: { label: "Track delivery" },
    href: "/shop/orders/1",
    ...overrides,
  };
}

test("AC1: Every reachable guest stage appears in exactly one group; a stage without a group fails the type check", async () => {
  for (const stage of GUEST_STAGES) {
    const mapped = planGroupForGuestStage(stage);
    const isBrowsing = stage === "discovery" || stage === "unit" || stage === "draft";
    if (isBrowsing) {
      assert.equal(mapped, null, `${stage} has not created a request or booking yet`);
    } else {
      assert.ok(mapped !== null && (PLAN_ROW_GROUPS as readonly string[]).includes(mapped), `${stage} maps to one PlanRowGroup`);
    }
  }
  const typeCheckHelper: (stage: GuestStage) => (typeof PLAN_ROW_GROUPS)[number] | null = planGroupForGuestStage;
  assert.equal(typeof typeCheckHelper, "function");

  const f = multiStayFixture();
  try {
    const guest = f.environment.guestPrincipal();

    const reqThread = "g-ac100001";
    const reqId = await driveRequestFor(f, reqThread, "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026");

    const offerThread = "g-ac100002";
    await driveOfferFor(f, offerThread, "Apartment in Lekki for 2 guests, 3 nights from 18 December 2026");

    const resThread = "g-ac100003";
    await driveReservationFor(f, resThread, "Apartment in Lekki for 2 guests, 3 nights from 22 December 2026");

    const beforeDecline = await f.app.planRows(guest, undefined, LIVE_LIKE_CLOCK());
    assert.equal(beforeDecline.groups.needs_action.length, 1, "issued offer is in needs_action");
    assert.equal(beforeDecline.groups.in_progress.length, 2, "disclosed request and upcoming confirmed stay are in in_progress");
    assert.equal(beforeDecline.groups.past.length, 0);
    assert.equal(beforeDecline.badgeCount, 1);

    const requestRow = beforeDecline.groups.in_progress.find((row) => row.rowId === `stays:request:${reqId}`);
    assert.ok(requestRow, "request row present");
    assert.doesNotMatch(JSON.stringify(requestRow), /Reservation/i, "S3: Booking Request is never shown as a Reservation");

    f.environment.simulateOperatorDecline(reqId, "Unavailable for those dates");

    const resRow = beforeDecline.groups.in_progress.find((row) => row.rowId.startsWith("stays:contract:"));
    assert.ok(resRow);
    const contractId = resRow.href.split("/").at(-1)!;
    const contractFacts = f.environment.contractApp.getArtifact(contractId, guest).facts;
    const resOfferId = (JSON.parse(f.environment.interactionStore.findThread(resThread)!.threadJson) as { offerId: string }).offerId;
    const existingReservation = f.environment.contractRepository.findReservationById(contractFacts.reservationId)!;
    f.environment.contractRepository.recordConfirmedOutcome(
      { ...existingReservation, status: "cancelled" },
      f.environment.cardPaymentApp.getBookingContract(resOfferId)!,
    );

    const afterChanges = await f.app.planRows(guest, undefined, LIVE_LIKE_CLOCK());
    assert.equal(afterChanges.groups.needs_action.length, 1);
    assert.equal(afterChanges.groups.in_progress.length, 0);
    assert.equal(afterChanges.groups.past.length, 2, "declined request and cancelled reservation move to past");
    const allIds = [...afterChanges.groups.needs_action, ...afterChanges.groups.in_progress, ...afterChanges.groups.past].map((r) => r.rowId);
    assert.equal(new Set(allIds).size, allIds.length, "each booking appears in at most one group");
  } finally {
    f.close();
  }
});

test("AC2: needs_action is true exactly while the server would accept the action (one instant either side of every deadline)", async () => {
  const f = multiStayFixture();
  try {
    const guest = f.environment.guestPrincipal();

    // 1. Booking Request deadline (operatorResponseDeadlineAt): in_progress -> past at exact deadline instant.
    const reqId = await driveRequestFor(f, "g-ac200001", "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026");
    const req = f.environment.interactionStore.findBookingRequest(reqId)!;
    const reqDeadlineMs = Date.parse(req.operatorResponseDeadlineAt);

    const beforeReqDeadline = await f.app.planRows(guest, undefined, new Date(reqDeadlineMs - 1));
    assert.equal(beforeReqDeadline.groups.in_progress.some((r) => r.rowId === `stays:request:${reqId}`), true, "1 ms before request deadline: still in_progress");
    const atReqDeadline = await f.app.planRows(guest, undefined, new Date(reqDeadlineMs));
    assert.equal(atReqDeadline.groups.past.some((r) => r.rowId === `stays:request:${reqId}`), true, "at request deadline: lazily moves to past");

    // 2. Issued Conditional Offer paymentWindow.expiresAt: needs_action -> past 1 ms before / at deadline.
    const offerSurface = await driveOfferFor(f, "g-ac200002", "Apartment in Lekki for 2 guests, 3 nights from 18 December 2026");
    const offerId = offerSurface.surfaceId.split(":").at(-1)!;
    const offerDeadlineMs = Date.parse(f.environment.conditionalOfferApp.getOffer(offerId).paymentWindow.expiresAt);

    const beforeOfferDeadline = await f.app.planRows(guest, undefined, new Date(offerDeadlineMs - 1));
    assert.equal(beforeOfferDeadline.groups.needs_action.some((r) => r.rowId === `stays:offer:${offerId}`), true, "1 ms before offer deadline: needs_action");
    assert.equal(beforeOfferDeadline.badgeCount, 1);

    const atOfferDeadline = await f.app.planRows(guest, undefined, new Date(offerDeadlineMs));
    assert.equal(atOfferDeadline.groups.needs_action.some((r) => r.rowId === `stays:offer:${offerId}`), false, "at offer deadline: not needs_action");
    assert.equal(atOfferDeadline.groups.past.some((r) => r.rowId === `stays:offer:${offerId}`), true, "at offer deadline: moves to past");
    assert.equal(atOfferDeadline.badgeCount, 0);

    // 3. Accepted Offer awaiting payment: needs_action -> past 1 ms before / at paymentWindow.expiresAt.
    const paySurface = await drivePaymentFor(f, "g-ac200003", "Apartment in Lekki for 2 guests, 3 nights from 22 December 2026");
    const payOfferId = paySurface.surfaceId.split(":").at(-1)!;
    const payDeadlineMs = Date.parse(f.environment.conditionalOfferApp.getOffer(payOfferId).paymentWindow.expiresAt);

    const beforePayDeadline = await f.app.planRows(guest, undefined, new Date(payDeadlineMs - 1));
    assert.equal(beforePayDeadline.groups.needs_action.some((r) => r.rowId === `stays:offer:${payOfferId}`), true, "1 ms before payment window expiry: needs_action");
    const atPayDeadline = await f.app.planRows(guest, undefined, new Date(payDeadlineMs));
    assert.equal(atPayDeadline.groups.needs_action.some((r) => r.rowId === `stays:offer:${payOfferId}`), false, "at payment window expiry: not needs_action");
    assert.equal(atPayDeadline.groups.past.some((r) => r.rowId === `stays:offer:${payOfferId}`), true, "at payment window expiry: moves to past");
  } finally {
    f.close();
  }

  // 4. Extended Stay billing period payable window (payableFromMs -> dueDate -> startMs).
  const extScript = {
    "Ikoyi for 31 nights, 2 guests from 28 October 2026": {
      slots: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: "2026-10-28", nights: 31, guests: 2 },
      search: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: "2026-10-28", nights: 31, guests: 2 },
    },
  };
  const ext = datedFixture(scriptedPlanner(extScript).client, undefined, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const seeded = ext.environment.unitRepository.findAll()[0]!;
    ext.environment.unitRepository.save(extendUnit(seeded, {}));
    const extThread = "g-ac200004";
    const search = successOf(await ext.app.handleTurn(extThread, "Ikoyi for 31 nights, 2 guests from 28 October 2026"), "ext search");
    const detail = await tap(ext, extThread, search.surfaces[0]!, "View");
    const draft = await tap(ext, extThread, detail.surfaces[0]!, "Request to Book");
    const phoneAsk = await tap(ext, extThread, draft.surfaces[0]!, "Review request");
    const phoneSave = firstButtonAction(phoneAsk.surfaces[0]!);
    const saved = successOf(await coldApp(ext, extThread).app.handleEventAsync(extThread, { ...phoneSave, context: { ...phoneSave.context, contactValue: PHONE } }), "save phone");
    const sent = await tap(ext, extThread, saved.surfaces[0]!, "Send booking request");
    const reqId = sent.surfaces[0]!.surfaceId.split(":").at(-1)!;
    ext.environment.simulateOperatorAcceptance(reqId);
    const offer = coldApp(ext, extThread).app.getState(extThread)!.surfaces[0]!;
    const offerId = offer.surfaceId.split(":").at(-1)!;
    const payment = await tap(ext, extThread, offer, "Accept offer");
    const checkout = await tap(ext, extThread, payment.surfaces[0]!, "Start checkout");
    const emailAsk = firstButtonAction(checkout.surfaces[0]!);
    const emailSaved = successOf(await coldApp(ext, extThread).app.handleEventAsync(extThread, { ...emailAsk, context: { ...emailAsk.context, contactValue: EMAIL } }), "save email");
    await tap(ext, extThread, emailSaved.surfaces[0]!, "Payment return");

    const periods = ext.environment.cardPaymentApp.projectBillingPeriods(offerId, LIVE_LIKE_CLOCK());
    assert.ok(periods.length >= 2, "extended stay has a second billing period");
    const p1StartMs = Date.parse(`${periods[0]!.checkIn}T00:00:00.000Z`);
    const p2DueMs = Date.parse(`${periods[1]!.dueDate}T00:00:00.000Z`);
    const guest = ext.environment.guestPrincipal();

    const beforePayable = await ext.app.planRows(guest, undefined, new Date(p1StartMs - 1));
    assert.equal(beforePayable.groups.in_progress.length, 1, "1 ms before period 1 starts: period 2 is scheduled, stay is in_progress");
    assert.equal(beforePayable.badgeCount, 0);

    const whilePayable = await ext.app.planRows(guest, undefined, new Date(p1StartMs));
    assert.equal(whilePayable.groups.needs_action.length, 1, "at period 1 start: period 2 is payable, stay moves to needs_action");
    assert.equal(whilePayable.badgeCount, 1);

    const justBeforeDue = await ext.app.planRows(guest, undefined, new Date(p2DueMs - 1));
    assert.equal(justBeforeDue.groups.needs_action.length, 1, "1 ms before period 2 dueDate: still payable (needs_action)");

    const atDue = await ext.app.planRows(guest, undefined, new Date(p2DueMs));
    assert.equal(atDue.groups.needs_action.length, 0, "at period 2 dueDate: overdue, no longer payable via Pay button");
    assert.equal(atDue.groups.in_progress.length, 1);
  } finally {
    ext.close();
  }
});

test("AC3: A pack that throws, returns an unknown shape, or is unregistered contributes no rows; other packs' rows remain", async () => {
  const f = multiStayFixture();
  try {
    const guest = f.environment.guestPrincipal();
    await driveOfferFor(f, "g-ac300001", "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026");
    const staysPack = createShortletAssistantPack(f.environment);
    const diagnostics: PlanRowsDiagnostic[] = [];

    const throwingPack: AssistantDomainPack = {
      ...createStubPack({ id: "broken_throw" }),
      planRows: () => { throw new Error("boom"); },
    };
    const unknownKeyPack: AssistantDomainPack = {
      ...createStubPack({ id: "broken_shape" }),
      planRows: () => [{ ...makeFakeRow({ domain: "broken_shape" }), secretPriceKobo: 50_000 } as unknown as PlanRow],
    };
    const wrongDomainPack: AssistantDomainPack = {
      ...createStubPack({ id: "other_domain" }),
      planRows: () => [makeFakeRow({ domain: "shortlet" })],
    };
    const unregisteredPack: AssistantDomainPack = {
      ...createFakeShopPack({ planRows: () => [makeFakeRow({ rowId: "unregistered:1", title: "Should Never Appear" })] }),
      id: "unregistered",
    };
    void unregisteredPack;

    const composed = await composePlanRows(
      [staysPack, throwingPack, unknownKeyPack, wrongDomainPack],
      { principal: guest },
      LIVE_LIKE_CLOCK(),
      { onDiagnostic: (event) => diagnostics.push(event) },
    );

    assert.equal(composed.groups.needs_action.length, 1, "stays row remains despite failing packs");
    assert.equal(composed.groups.needs_action[0]!.domain, "shortlet");
    assert.deepEqual(composed.droppedDomains, ["broken_throw", "broken_shape", "other_domain"]);
    assert.deepEqual(diagnostics, [
      { event: "plan_rows_pack_dropped", domain: "broken_throw", reason: "threw" },
      { event: "plan_rows_pack_dropped", domain: "broken_shape", reason: "invalid_shape" },
      { event: "plan_rows_pack_dropped", domain: "other_domain", reason: "invalid_shape" },
    ]);
    assert.equal(validatePackPlanRows([makeFakeRow({ href: "https://evil.example/phish" })], "shop"), null);
    assert.equal(validatePackPlanRows([makeFakeRow({ startsOn: "2026-02-31" })], "shop"), null);
    assert.equal(validatePackPlanRows("not-an-array", "shop"), null);
  } finally {
    f.close();
  }
});

test("AC4: Two packs (stays and fake-domain-pack) merge in the fixed order with the right badge", async () => {
  const f = multiStayFixture();
  try {
    const guest = f.environment.guestPrincipal();
    await driveRequestFor(f, "g-ac400001", "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026");
    const offerSurface = await driveOfferFor(f, "g-ac400002", "Apartment in Lekki for 2 guests, 3 nights from 18 December 2026");
    const offerId = offerSurface.surfaceId.split(":").at(-1)!;
    const offerDeadline = f.environment.conditionalOfferApp.getOffer(offerId).paymentWindow.expiresAt;
    const earlierDeadline = new Date(Date.parse(offerDeadline) - 60_000).toISOString();

    const shopPack = createFakeShopPack({
      planRows: () => [
        makeFakeRow({
          rowId: "shop:action:1",
          group: "needs_action",
          startsOn: "2026-11-20",
          endsOn: "2026-11-20",
          nextStep: { label: "Confirm delivery slot", deadlineAt: earlierDeadline },
        }),
        makeFakeRow({
          rowId: "shop:prog:1",
          group: "in_progress",
          startsOn: "2026-11-05",
          endsOn: "2026-11-06",
        }),
        makeFakeRow({
          rowId: "shop:past:older",
          group: "past",
          startsOn: "2026-08-01",
          endsOn: "2026-08-03",
        }),
        makeFakeRow({
          rowId: "shop:past:newer",
          group: "past",
          startsOn: "2026-09-10",
          endsOn: "2026-09-12",
        }),
      ],
    });
    const staysPack = createShortletAssistantPack(f.environment);

    const app = new LocalGuestApp(f.environment, { packs: [staysPack, shopPack] });
    const composed = await app.planRows(guest, undefined, LIVE_LIKE_CLOCK());

    assert.equal(composed.badgeCount, 2, "badgeCount equals total needs_action rows across both packs");
    assert.deepEqual(
      composed.groups.needs_action.map((r) => r.rowId),
      ["shop:action:1", `stays:offer:${offerId}`],
      "needs_action is ordered by soonest deadline first",
    );
    assert.equal(composed.groups.in_progress[0]!.rowId, "shop:prog:1", "in_progress is ordered by startsOn ascending");
    assert.equal(composed.groups.in_progress[1]!.domain, "shortlet");
    assert.deepEqual(
      composed.groups.past.map((r) => r.rowId),
      ["shop:past:newer", "shop:past:older"],
      "past is ordered by most recent endsOn first",
    );
  } finally {
    f.close();
  }
});

test("AC5: No row holds a price, contact, address, identity fact or credential", async () => {
  const f = multiStayFixture();
  try {
    const guest = f.environment.guestPrincipal();
    await driveRequestFor(f, "g-ac500001", "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026");
    await driveOfferFor(f, "g-ac500002", "Apartment in Lekki for 2 guests, 3 nights from 18 December 2026");
    await drivePaymentFor(f, "g-ac500003", "Apartment in Lekki for 2 guests, 3 nights from 22 December 2026");
    await driveReservationFor(f, "g-ac500004", "Apartment in Lekki for 2 guests, 3 nights from 26 December 2026");

    const composed = await f.app.planRows(guest, undefined, LIVE_LIKE_CLOCK());
    const allRows = [...composed.groups.needs_action, ...composed.groups.in_progress, ...composed.groups.past];
    assert.equal(allRows.length, 4);
    for (const row of allRows) {
      assertRedactedRowShape(row);
      assert.doesNotMatch(row.where, /\d{2,}\s+[A-Za-z]+/, "where exposes neighbourhood and city only, never a street address");
    }
  } finally {
    f.close();
  }
});

test("AC6: Every read works after a cold restore", async () => {
  const f = multiStayFixture();
  try {
    const guest = f.environment.guestPrincipal();
    const threadId = "g-ac600001";
    await driveOfferFor(f, threadId, "Apartment in Lekki for 2 guests, 3 nights from 14 December 2026");

    const beforeRestart = await f.app.planRows(guest, undefined, LIVE_LIKE_CLOCK());
    const committedBefore = await f.app.committedWork(guest);

    const restarted = trueRestartedDatedApp(f, scriptedPlanner(MULTI_STAY_SCRIPT).client, undefined, { clock: LIVE_LIKE_CLOCK });
    try {
      const afterRestart = await restarted.app.planRows(guest, undefined, LIVE_LIKE_CLOCK());
      const committedAfter = await restarted.app.committedWork(guest);
      assert.deepEqual(afterRestart, beforeRestart, "planRows matches identically after cold SQLite restore");
      assert.deepEqual(committedAfter, committedBefore, "committedWork matches identically after cold SQLite restore");

      const secondApp = restartedDatedApp(restarted, scriptedPlanner(MULTI_STAY_SCRIPT).client).app;
      assert.deepEqual(await secondApp.planRows(guest, undefined, LIVE_LIKE_CLOCK()), beforeRestart);
    } finally {
      restarted.close();
    }
  } finally {
    f.close();
  }
});

test("Decision table (rules/02): 6 viewers × 4 bookings = 24 cells, and strangers keep the identical 404", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plan-rows-24-"));
  const databasePath = join(dir, "guest.sqlite");
  try {
    const makeDevice = async (guestId: string, initialGuestContactEmail: string | null, text: string) => {
      const device = await restartFixture({
        databasePath,
        guestId,
        initialGuestPhoneNumber: PHONE,
        initialGuestContactEmail,
      });
      const result = await device.advance("pending", undefined, text);
      return { device, requestId: result.surfaces[0]!.surfaceId.split(":").at(-1)! };
    };

    const { device: deviceA, requestId: ownReqId } = await makeDevice("guest-device-a", null, "I need an apartment in Ikoyi from 10 Sept for 2 nights for 1 person");
    const { device: deviceB, requestId: linkedReqId } = await makeDevice("guest-device-b", null, "I need an apartment in Ikoyi from 15 Sept for 2 nights for 1 person");
    const { device: deviceClaimed, requestId: claimedReqId } = await makeDevice("guest-claimed-src", "ada@example.test", "I need an apartment in Ikoyi from 20 Sept for 2 nights for 1 person");
    const { device: deviceC, requestId: foreignReqId } = await makeDevice("guest-device-c", null, "I need an apartment in Ikoyi from 25 Sept for 2 nights for 1 person");

    const db = openNodeSqliteDatabase(databasePath);
    try {
      let authNowMs = deviceA.environment.clock().getTime();
      const authClock = () => new Date(authNowMs);
      const authority = new SqliteGuestAccountAuthority(db, { codeHashingKey: TEST_GUEST_CODE_HASHING_KEY, clock: authClock });
      const links = new SqliteGuestAccountLinks(db, { requests: new SqliteGuestInteractionStore(db), authority, clock: authClock });
      const resolver = new GuestIdentityResolver(authority, links, { hasCurrentGovernmentId: () => false });
      const tenantId = deviceA.environment.config.tenantId;

      const sessionA = signInGuestAccount(authority, "ada@example.test", tenantId);
      links.linkSignedInPrincipal({ principalId: "guest-device-a", tenantId, session: sessionA });
      authNowMs += 61_000;
      const sessionB = signInGuestAccount(authority, "ada@example.test", tenantId);
      links.linkSignedInPrincipal({ principalId: "guest-device-b", tenantId, session: sessionB });
      authNowMs += 61_000;
      const sessionC = signInGuestAccount(authority, "grace@example.test", tenantId);
      links.linkSignedInPrincipal({ principalId: "guest-device-c", tenantId, session: sessionC });

      const identityA = (await resolver.resolve({ principalId: "guest-device-a", tenantId, accountSession: { sessionId: sessionA.sessionId, sessionSecret: sessionA.sessionSecret } }))!;
      const identityB = (await resolver.resolve({ principalId: "guest-device-b", tenantId, accountSession: { sessionId: sessionB.sessionId, sessionSecret: sessionB.sessionSecret } }))!;
      const identityC = (await resolver.resolve({ principalId: "guest-device-c", tenantId, accountSession: { sessionId: sessionC.sessionId, sessionSecret: sessionC.sessionSecret } }))!;

      const signedOutEnv = LocalGuestEnvironment.openNode({ databasePath, guestId: "guest-device-a-rotated" });
      try {
        const viewers: {
          readonly name: string;
          readonly app: LocalGuestApp;
          readonly principal: CommandPrincipal;
          readonly identity?: GuestIdentity;
          readonly expected: readonly string[];
        }[] = [
          { name: "no_session", app: deviceA.app, principal: { id: "", role: "guest", tenantId }, expected: [] },
          { name: "device_session", app: deviceA.app, principal: deviceA.environment.guestPrincipal(), expected: [ownReqId] },
          { name: "signed_in_device_a", app: deviceA.app, principal: deviceA.environment.guestPrincipal(), identity: identityA, expected: [ownReqId, linkedReqId, claimedReqId] },
          { name: "signed_in_second_device_b", app: deviceB.app, principal: deviceB.environment.guestPrincipal(), identity: identityB, expected: [ownReqId, linkedReqId, claimedReqId] },
          { name: "signed_out_again", app: new LocalGuestApp(signedOutEnv), principal: signedOutEnv.guestPrincipal(), expected: [] },
          { name: "another_guest_c", app: deviceC.app, principal: deviceC.environment.guestPrincipal(), identity: identityC, expected: [foreignReqId] },
        ];

        const bookings = [
          { name: "own", id: ownReqId },
          { name: "linked", id: linkedReqId },
          { name: "claimed", id: claimedReqId },
          { name: "foreign", id: foreignReqId },
        ] as const;

        let checkedCells = 0;
        for (const viewer of viewers) {
          const entries = await collectStaysPlanEntries(viewer.app.environment, { principal: viewer.principal, identity: viewer.identity }, deviceA.environment.clock());
          const visibleIds = new Set(entries.map((entry) => entry.row.rowId.replace("stays:request:", "")));
          for (const booking of bookings) {
            checkedCells += 1;
            const shouldSee = viewer.expected.includes(booking.id);
            assert.equal(visibleIds.has(booking.id), shouldSee, `cell (${viewer.name} × ${booking.name}): expected ${shouldSee}`);
          }
          const committed = await viewer.app.committedWork(viewer.principal, viewer.identity);
          assert.equal(committed.length, viewer.expected.length, `${viewer.name} committedWork count matches`);
        }
        assert.equal(checkedCells, 24, "all 6 × 4 = 24 cells were verified");
      } finally {
        signedOutEnv.close();
      }
    } finally {
      db.close();
      await deviceC.close();
      await deviceClaimed.close();
      await deviceB.close();
      await deviceA.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // HTTP 404 parity check: a stranger requesting a foreign booking/offer page receives the exact identical 404 as a nonexistent id.
  const { fixture, sender } = await accountFixture();
  try {
    // Save phone for sessionScopedGuestPrincipals before advancing through review -> offer.
    await fixture.send("/api/turn", { text: "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people" });
    const searchState = await fixture.state();
    assert.equal(searchState.ok, true);
    const view = await fixture.send("/api/event", guestActionSafe(searchState.ok ? searchState.surfaces[0]! : undefined));
    assert.equal(view.ok, true);
    const draft = await fixture.send("/api/event", guestActionSafe(view.ok ? view.surfaces[0]! : undefined));
    assert.equal(draft.ok, true);
    const reviewOrPhone = await fixture.send("/api/event", guestActionSafe(draft.ok ? draft.surfaces[0]! : undefined));
    assert.equal(reviewOrPhone.ok, true);
    let pendingResult = reviewOrPhone as Awaited<ReturnType<typeof fixture.send>>;
    if (reviewOrPhone.ok && reviewOrPhone.surfaces[0]?.surfaceId.includes(":contact:phone:")) {
      const action = guestActionSafe(reviewOrPhone.surfaces[0]!);
      const saved = await fixture.send("/api/event", { ...action, context: { ...action.context, contactValue: PHONE } });
      assert.equal(saved.ok, true);
      pendingResult = await fixture.send("/api/event", guestActionSafe(saved.ok ? saved.surfaces[0]! : undefined));
    }
    assert.equal(pendingResult.ok, true);
    const requestId = pendingResult.ok ? pendingResult.surfaces[0]!.surfaceId.split(":").at(-1)! : "";
    fixture.environment.simulateOperatorAcceptance(requestId);
    const offerState = await fixture.state();
    assert.equal(offerState.ok, true);
    const offerRoute = offerState.ok ? offerState.surfaces[0]?.conventionalRoute : undefined;
    assert.ok(offerRoute);

    const strangerHome = await fetch(fixture.base);
    const strangerCookie = strangerHome.headers.get("set-cookie")?.split(";")[0]!;
    await strangerHome.text();
    const strangerDevice = await signInDevice(fixture, sender, "stranger@example.test", strangerCookie);
    const strangerCookies = deviceCookies(strangerDevice);

    const foreignOffer = await getPage(fixture.base, offerRoute, strangerCookies);
    const missingOffer = await getPage(fixture.base, "/conditional-offers/offer-does-not-exist", strangerCookies);
    assert.equal(foreignOffer.status, 404);
    assert.equal(missingOffer.status, 404);
    assert.equal(foreignOffer.body, missingOffer.body, "strangers get the exact identical 404 HTML for foreign and missing offers");
  } finally {
    await fixture.close();
  }
});

function guestActionSafe(surface: { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] } | undefined) {
  assert.ok(surface);
  const update = surface.a2uiMessages.find((m): m is { updateComponents: { components: readonly { component: string; action?: { event?: { name: string; context: Record<string, unknown> } } }[] } } => typeof m === "object" && m !== null && "updateComponents" in m);
  assert.ok(update);
  const event = update.updateComponents.components.find((c) => c.component === "Button" && c.action?.event)?.action?.event;
  assert.ok(event);
  return { name: event.name, context: event.context, surfaceId: surface.surfaceId, sourceComponentId: "test", timestamp: new Date().toISOString() };
}

test("Smoke: restartFixture /api/committed-work matches collectStaysPlanEntries", async () => {
  const fixture = await restartFixture();
  try {
    await fixture.advance("pending");
    const response = await fetch(`${fixture.base}/api/committed-work`, { headers: { cookie: fixture.cookie } });
    assert.equal(response.status, 200);
    const json = (await response.json()) as { ok: boolean; committedWork: unknown[] };
    assert.equal(json.ok, true);
    assert.equal(json.committedWork.length, 1);
  } finally {
    await fixture.close();
  }
});
