import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECK_IN,
  NIGHTS,
  EXT_TEXT,
  EXT_SLOTS,
  NOTICE_TEXT,
  OPEN_EVENT,
  TYPED_CONFIRMATIONS,
  PLANNER_TOOL,
  SCRIPT,
  model,
  extendedFixture,
  contractOf,
  extendedToReservation,
  recordVerifiedAccess,
  buttonNamed,
  cardOpen,
} from "./helpers/notice-chat-journey.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ASSISTANT_CONTROL_COPY } from "../apps/local-guest/src/assistant/control-copy.js";
import { ASSISTANT_CANCEL_ACTION_EVENT, ASSISTANT_CONFIRM_ACTION_EVENT } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { GUEST_NOTICE_COPY, noticeFactRows } from "../apps/web-agent/src/guest-content.js";
import { formatMoney } from "../apps/web/src/ui-kit.js";
import { SqliteCheckInSupportStore } from "../domains/shortlet/src/checkin-support.js";
import { SqliteBookingStateRepository } from "../domains/shortlet/src/booking-state.js";
import type { BookingContract } from "../domains/shortlet/src/card-payment.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { coldApp, EMAIL, JOURNEY_SCRIPT, journeyToReservation, PHONE, successOf, tap, type Surface } from "./helpers/assistant-stage-journey.js";
import { addDays, extendUnit } from "./helpers/demo-extended-journey.js";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, scriptedPlanner, wireDatedApp, type DatedFixture, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";

// Monthly-stays issue 18 (ADR 0106, ADR 0092 amended, ADR 0060, ADR 0074, ADR 0077/0080). A Notice to End from the chat:
// the card opens from the confirmed Extended Stay, only a structured confirmation from the card records notice, and every
// event runs on a cold restore (a new app over the same store) with the assistant enabled, clock 27 Oct 2026, staging guest.

// Check-in is the day after the staging clock (27 Oct 2026), so a notice given on that clock leaves nights to stay (ADR 0092).
test("AC1: From a confirmed Extended Stay after Verified Access, the chat action opens the notice card with the same facts as the issue 17 page", async () => {
  const threadId = "g-0cc1000101";
  const f = extendedFixture();
  try {
    const { booking, offerId } = await extendedToReservation(f, threadId);
    const contract = contractOf(f, offerId);
    recordVerifiedAccess(f, contract.reservationId);
    const opened = successOf(await coldApp(f, threadId, model()).app.handleEventAsync(threadId, buttonNamed(booking, OPEN_EVENT)), "open the notice card");
    const card = opened.surfaces[0]!;
    assert.match(card.surfaceId, /:pending-action:/, "the card is the pending-action surface");
    const preview = f.environment.noticeToEnd.previewNotice(contract.contractId, f.environment.guestPrincipal());
    const json = JSON.stringify(card.a2uiMessages);
    for (const row of noticeFactRows(preview, formatMoney)) assert.ok(json.includes(row.value), `the card shows ${row.label}: ${row.value}`);
    assert.ok(json.includes(GUEST_NOTICE_COPY.confirm) && json.includes(GUEST_NOTICE_COPY.back), "the card has the Give notice and Keep my stay actions");
    assert.equal(f.environment.cardPaymentApp.getBookingContract(offerId)!.contractVersion, 1, "opening the card changes nothing");
  } finally {
    f.close();
  }
});

test("AC2: Give notice on the card commits exactly one versioned Booking Amendment, and Keep my stay changes nothing", async () => {
  const threadId = "g-0cc1000201";
  const f = extendedFixture();
  try {
    const { booking, offerId } = await extendedToReservation(f, threadId);
    recordVerifiedAccess(f, contractOf(f, offerId).reservationId);
    const card = successOf(await coldApp(f, threadId, model()).app.handleEventAsync(threadId, buttonNamed(booking, OPEN_EVENT)), "open").surfaces[0]!;

    const kept = successOf(await coldApp(f, threadId).app.handleEventAsync(threadId, { ...buttonNamed(card, ASSISTANT_CONFIRM_ACTION_EVENT), name: ASSISTANT_CANCEL_ACTION_EVENT }), "keep my stay");
    assert.equal(kept.messages.length > 0, true, "keeping the stay replies");
    assert.equal(contractOf(f, offerId).contractVersion, 1, "Keep my stay changes nothing");

    const reopened = successOf(await coldApp(f, threadId, model()).app.handleEventAsync(threadId, buttonNamed(booking, OPEN_EVENT)), "reopen").surfaces[0]!;
    successOf(await coldApp(f, threadId).app.handleEventAsync(threadId, buttonNamed(reopened, ASSISTANT_CONFIRM_ACTION_EVENT)), "give notice");
    const after = contractOf(f, offerId);
    assert.equal(after.contractVersion, 2, "one versioned Booking Amendment");
    assert.ok(after.noticeToEnd, "the notice is recorded on the contract");
    assert.equal(cardOpen(f, threadId), false, "the card is closed once notice is given");
    // Once notice is recorded, the same booking press is refused: nothing opens and nothing changes (ADR 0060).
    const again = await coldApp(f, threadId, model()).app.handleEventAsync(threadId, { name: OPEN_EVENT, surfaceId: booking.surfaceId, context: { surfaceId: booking.surfaceId, threadId } });
    assert.equal(again.ok, false, "a second notice is not offered");
    assert.equal(contractOf(f, offerId).contractVersion, 2, "the refused press changes nothing");
    const artifact = f.environment.contractApp.getArtifact(contractOf(f, offerId).contractId, f.environment.guestPrincipal());
    assert.equal(artifact.facts.noticeToEnd?.newLastNight, contractOf(f, offerId).noticeToEnd?.newLastNight, "the booking artifact shows the recorded notice");
  } finally {
    f.close();
  }
});

test("AC3: Typed confirmations (yes, ok, confirm, go ahead) with a give_notice card open never record notice, and the card stays open", async () => {
  const threadId = "g-0cc1000301";
  const f = extendedFixture();
  try {
    const { booking, offerId } = await extendedToReservation(f, threadId);
    recordVerifiedAccess(f, contractOf(f, offerId).reservationId);
    successOf(await coldApp(f, threadId, model()).app.handleEventAsync(threadId, buttonNamed(booking, OPEN_EVENT)), "open");
    for (const text of TYPED_CONFIRMATIONS) {
      const result = await coldApp(f, threadId, model()).app.handleTurn(threadId, text);
      assert.equal(result.ok, true, `"${text}" gets a reply, not a refusal code`);
      if (!result.ok) continue;
      assert.deepEqual(result.messages, [ASSISTANT_CONTROL_COPY.useCardButtons], `"${text}" is told to use the card`);
      assert.equal(contractOf(f, offerId).contractVersion, 1, `"${text}" records no notice`);
      assert.equal(contractOf(f, offerId).noticeToEnd, undefined, `"${text}" leaves no notice on the contract`);
      assert.equal(cardOpen(f, threadId), true, `"${text}" leaves the card open`);
    }
  } finally {
    f.close();
  }
});

test("AC4: A guest asking in chat to end early is offered the card through the planner tool, which never records notice itself", async () => {
  const threadId = "g-0cc1000401";
  const f = extendedFixture();
  try {
    const { offerId } = await extendedToReservation(f, threadId);
    recordVerifiedAccess(f, contractOf(f, offerId).reservationId);
    const result = successOf(await coldApp(f, threadId, model()).app.handleTurn(threadId, NOTICE_TEXT), "ask to end early");
    assert.ok(result.surfaces.some((surface) => surface.surfaceId.includes(":pending-action:")), "the planner offers the card");
    assert.equal(contractOf(f, offerId).contractVersion, 1, "the tool records nothing by itself");
  } finally {
    f.close();
  }
});

test("AC5: On a Short Stay, or before Verified Access, the tool is a tool_denial with a guest sentence and the action is not shown", async () => {
  // A Short Stay: the chat journey's own 3-night stay, with the notice text asked after it is confirmed.
  const shortDiagnostics: AssistantDiagnosticEvent[] = [];
  const shortThread = "g-0cc1000501";
  const shortFixture = datedFixture(model(), shortDiagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const shortBooking = await journeyToReservation(shortFixture, shortThread);
    assert.equal(JSON.stringify(shortBooking.a2uiMessages).includes(OPEN_EVENT), false, "a Short Stay's booking surface has no Give notice action");
    const shortAsk = successOf(await wireDatedApp(shortFixture.environment, model(), shortDiagnostics).app.handleTurn(shortThread, NOTICE_TEXT), "ask on a Short Stay");
    assert.deepEqual(shortAsk.messages, [GUEST_NOTICE_COPY.notExtended], "the Short Stay refusal is the guest sentence");
    assert.equal(shortAsk.surfaces.some((surface) => surface.surfaceId.includes(":pending-action:")), false, "no card for a Short Stay");
    assert.ok(shortDiagnostics.some((event) => event.stage === "application_operation" && event.toolName === "propose_notice_to_end" && event.succeeded === false), "the refused tool call is recorded as a denial");
  } finally {
    shortFixture.close();
  }

  // An Extended Stay before Verified Access.
  const threadId = "g-0cc1000502";
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = extendedFixture(diagnostics);
  try {
    const { booking, offerId } = await extendedToReservation(f, threadId);
    const ask = successOf(await wireDatedApp(f.environment, model(), diagnostics).app.handleTurn(threadId, NOTICE_TEXT), "ask before access");
    assert.deepEqual(ask.messages, [GUEST_NOTICE_COPY.notVerified], "the pre-access refusal is the guest sentence");
    assert.ok(diagnostics.some((event) => event.stage === "application_operation" && event.toolName === "propose_notice_to_end" && event.succeeded === false), "the pre-access refused tool call is recorded as a denial");
    const press = await coldApp(f, threadId, model()).app.handleEventAsync(threadId, buttonNamed(booking, OPEN_EVENT));
    assert.equal(press.ok, false, "the card does not open before Verified Access");
    assert.equal(cardOpen(f, threadId), false, "no card before Verified Access");
    assert.equal(contractOf(f, offerId).contractVersion, 1, "nothing changes before Verified Access");
  } finally {
    f.close();
  }
});

test("AC6: Forged, superseded or unknown surface ids, and a superseded contract version, are refused with STALE_SURFACE and change nothing", async () => {
  const threadId = "g-0cc1000601";
  const f = extendedFixture();
  try {
    const { booking, offerId } = await extendedToReservation(f, threadId);
    const contract = contractOf(f, offerId);
    recordVerifiedAccess(f, contract.reservationId);
    const card = successOf(await coldApp(f, threadId, model()).app.handleEventAsync(threadId, buttonNamed(booking, OPEN_EVENT)), "open").surfaces[0]!;
    const confirm = buttonNamed(card, ASSISTANT_CONFIRM_ACTION_EVENT);

    const forged = await coldApp(f, threadId).app.handleEventAsync(threadId, { ...confirm, context: { ...confirm.context, surfaceId: `thread-${threadId}:pending-action:pa-forged` } });
    assert.equal(forged.ok === false ? forged.code : "ok", "STALE_SURFACE", "a forged surface id is refused");

    const unknown = await coldApp(f, threadId).app.handleEventAsync(threadId, { ...confirm, context: { ...confirm.context, actionId: "pa-unknown" } });
    assert.equal(unknown.ok === false ? unknown.code : "ok", "STALE_SURFACE", "an unknown action id is refused");

    // A contract amended elsewhere: the bound contract version no longer matches the card.
    const database = openNodeSqliteDatabase(f.databasePath!);
    try {
      new SqliteBookingStateRepository(database).mutateContract(contract.contractId, contract.contractVersion, (current) => ({ ...current, contractVersion: current.contractVersion + 1 }));
    } finally {
      database.close();
    }
    const superseded = await coldApp(f, threadId).app.handleEventAsync(threadId, confirm);
    assert.equal(superseded.ok === false ? superseded.code : "ok", "STALE_SURFACE", "a superseded contract version is refused");
    assert.equal(contractOf(f, offerId).noticeToEnd, undefined, "nothing is recorded after a refusal");
  } finally {
    f.close();
  }
});

test("AC7: The card's surface id and its bound values survive a cold restore unchanged, and every event above ran on a fresh app", async () => {
  const threadId = "g-0cc1000701";
  const f = extendedFixture();
  try {
    const { booking, offerId } = await extendedToReservation(f, threadId);
    recordVerifiedAccess(f, contractOf(f, offerId).reservationId);
    const card = successOf(await coldApp(f, threadId, model()).app.handleEventAsync(threadId, buttonNamed(booking, OPEN_EVENT)), "open").surfaces[0]!;
    const restored = coldApp(f, threadId).app.getState(threadId)!;
    const reRestored = (restored.surfaces ?? []).find((surface) => surface.surfaceId === card.surfaceId);
    assert.ok(reRestored, "the card is re-keyed on restore, not re-minted");
    assert.deepEqual(buttonNamed(reRestored!, ASSISTANT_CONFIRM_ACTION_EVENT).context, buttonNamed(card, ASSISTANT_CONFIRM_ACTION_EVENT).context, "the bound ids are unchanged");
  } finally {
    f.close();
  }
});
