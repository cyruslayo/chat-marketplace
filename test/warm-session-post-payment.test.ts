import assert from "node:assert/strict";
import test from "node:test";
import { STAY_LONGER_TEXT, NOTICE_TEXT, SCRIPT, model, contractOf, recordVerifiedAccess, extendedFixture } from "./helpers/notice-chat-journey.js";
import { bookedExtendedStayOverHttp, ok } from "./helpers/warm-http-journey.js";
import { coldApp, successOf, type Surface } from "./helpers/assistant-stage-journey.js";
import { scriptedPlanner, type DatedFixture } from "./helpers/guest-date-fixtures.js";
import { GUEST_ASSISTANT_COPY } from "../apps/web-agent/src/guest-content.js";
import { GUEST_EXTENSION_COPY, GUEST_NOTICE_COPY } from "../apps/web-agent/src/guest-content.js";

// Monthly-stays issues 09 and 18 (ADR 0106). After a booked and paid Extended Stay, a typed turn must reach the planner's preview
// tool on the WARM per-session runtime (the HTTP routes reuse one runtime per session). The shell rebuilds the task state from the
// thread, so the warm runtime must carry the same current offer a cold restore carries. Every test uses the assistant runtime.

const PENDING = ":pending-action:";
// ADR 0106: the status tool reads the booking the shell holds (the contract of the confirmed offer), so it must see it on the warm runtime too.
const STATUS_TEXT = "Where is my booking status?";
const STATUS_TOOL = { name: "get_booking_status", args: {} } as const;
const statusModel = () => scriptedPlanner({ ...SCRIPT, [STATUS_TEXT]: { slots: {}, intents: ["status"], tool: STATUS_TOOL, replyAfterTool: { kind: "show_status", references: ["get_booking_status"] } } }).client;
const cardOf = (surfaces: readonly Surface[]): Surface | undefined => surfaces.find((surface) => surface.surfaceId.includes(PENDING));

test("A typed extension request after payment opens the extension card on the warm session runtime", async () => {
  const f: DatedFixture = extendedFixture();
  const threadId = "g-0ee2000101";
  const { session } = await bookedExtendedStayOverHttp(f, threadId);
  try {
    const ask = ok(await session.post("/api/turn", { text: STAY_LONGER_TEXT }), "stay longer after payment");
    const card = cardOf(ask.surfaces);
    assert.ok(card, "the extension card is offered on the warm runtime");
    assert.ok(JSON.stringify(card.a2uiMessages).includes(GUEST_EXTENSION_COPY.addedNights), "the card is the extension card");
  } finally {
    session.close();
    f.close();
  }
});

test("A typed notice request after payment opens the notice card on the warm session runtime", async () => {
  const f: DatedFixture = extendedFixture();
  const threadId = "g-0ee2000201";
  const { session, offerId } = await bookedExtendedStayOverHttp(f, threadId);
  try {
    recordVerifiedAccess(f, contractOf(f, offerId).reservationId);
    const ask = ok(await session.post("/api/turn", { text: NOTICE_TEXT }), "end early after payment");
    const card = cardOf(ask.surfaces);
    assert.ok(card, "the notice card is offered on the warm runtime");
    assert.ok(JSON.stringify(card.a2uiMessages).includes(GUEST_NOTICE_COPY.newLastNight), "the card is the notice card");
    assert.ok(JSON.stringify(card.a2uiMessages).includes("Still to pay before then"), "the card shows the approved owed label (8 Nov 2026)");
  } finally {
    session.close();
    f.close();
  }
});

test("A typed extension request after payment opens the extension card on a cold restore", async () => {
  const f: DatedFixture = extendedFixture();
  const threadId = "g-0ee2000301";
  const { session, offerId } = await bookedExtendedStayOverHttp(f, threadId);
  session.close();
  try {
    const ask = successOf(await coldApp(f, threadId, model()).app.handleTurn(threadId, STAY_LONGER_TEXT), "stay longer after payment, cold");
    const card = cardOf(ask.surfaces);
    assert.ok(card && JSON.stringify(card.a2uiMessages).includes(GUEST_EXTENSION_COPY.addedNights), "the extension card is offered on a cold restore");
    assert.equal(contractOf(f, offerId).extensionRequest, undefined, "nothing is requested before the card's button");
  } finally {
    f.close();
  }
});

test("A typed notice request after payment opens the notice card on a cold restore", async () => {
  const f: DatedFixture = extendedFixture();
  const threadId = "g-0ee2000401";
  const { session, offerId } = await bookedExtendedStayOverHttp(f, threadId);
  session.close();
  try {
    recordVerifiedAccess(f, contractOf(f, offerId).reservationId);
    const ask = successOf(await coldApp(f, threadId, model()).app.handleTurn(threadId, NOTICE_TEXT), "end early after payment, cold");
    const card = cardOf(ask.surfaces);
    assert.ok(card && JSON.stringify(card.a2uiMessages).includes(GUEST_NOTICE_COPY.newLastNight), "the notice card is offered on a cold restore");
    assert.equal(contractOf(f, offerId).noticeToEnd, undefined, "nothing is recorded before the card's button");
  } finally {
    f.close();
  }
});

test("A typed booking status request after payment reports the confirmed contract on the warm session runtime", async () => {
  const f: DatedFixture = extendedFixture();
  const threadId = "g-0ee2000501";
  const { session, offerId } = await bookedExtendedStayOverHttp(f, threadId, statusModel());
  try {
    const contractId = contractOf(f, offerId).contractId;
    const status = ok(await session.post("/api/turn", { text: STATUS_TEXT }), "booking status after payment");
    assert.deepEqual(status.messages, [GUEST_ASSISTANT_COPY.confirmedBooking(contractId)], "the warm runtime sees the confirmed contract");
  } finally {
    session.close();
    f.close();
  }
});

test("A typed booking status request after payment reports the confirmed contract on a cold restore", async () => {
  const f: DatedFixture = extendedFixture();
  const threadId = "g-0ee2000601";
  const { session, offerId } = await bookedExtendedStayOverHttp(f, threadId, statusModel());
  session.close();
  try {
    const contractId = contractOf(f, offerId).contractId;
    const status = successOf(await coldApp(f, threadId, statusModel()).app.handleTurn(threadId, STATUS_TEXT), "booking status after payment, cold");
    assert.deepEqual(status.messages, [GUEST_ASSISTANT_COPY.confirmedBooking(contractId)], "a cold restore sees the confirmed contract");
  } finally {
    f.close();
  }
});
