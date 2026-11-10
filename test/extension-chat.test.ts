import assert from "node:assert/strict";
import test from "node:test";
import {
  EXT_TEXT,
  NOTICE_TEXT,
  STAY_LONGER_TEXT,
  SUPPORT_TEXT,
  TYPED_CONFIRMATIONS,
  model,
  extendedFixture,
  extendedToReservation,
  contractOf,
  coldRecording,
  recordVerifiedAccess,
  cardOpen,
  buttonNamed,
} from "./helpers/notice-chat-journey.js";
import { coldApp, successOf, journeyToReservation } from "./helpers/assistant-stage-journey.js";
import { datedFixture, LIVE_LIKE_CLOCK, wireDatedApp } from "./helpers/guest-date-fixtures.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { ASSISTANT_CONTROL_COPY } from "../apps/local-guest/src/assistant/control-copy.js";
import { confirmationContent } from "../apps/web-agent/src/confirmation-presentation.js";
import { GUEST_EXTENSION_COPY } from "../apps/web-agent/src/guest-content.js";
import { EXTENSION_OPEN_EVENT } from "../apps/web-agent/src/booking-contract-a2ui.js";

// Monthly-stays issue 09 (ADR 0092 Extensions, ADR 0106, ADR 0074). The chat extension: a preview-only planner tool, a card with
// the added periods, and a button-only confirmation. Every event runs on a new app over the same store (a cold restore), with the
// assistant enabled, the staging clock and a staging-like guest.

const CLOCK = new Date("2026-10-27T10:00:00Z");

/** The chat's extension card in a surface list, or undefined. */
function extensionCard(surfaces: readonly { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[] }[]) {
  return surfaces.find((surface) => surface.surfaceId.includes(":pending-action:"));
}

test("AC7: With the assistant enabled and a cold restore before every event, a guest can request an extension from the confirmed booking and sees the added periods before sending; refusals are tool_denial", async () => {
  const threadId = "g-0ee1000701";
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = extendedFixture(diagnostics, () => CLOCK);
  try {
    const { offerId } = await extendedToReservation(f, threadId);
    const before = contractOf(f, offerId);

    // The guest asks in chat; the planner offers the card. Nothing is requested yet.
    const ask = successOf(await coldRecording(f, threadId, diagnostics).app.handleTurn(threadId, STAY_LONGER_TEXT), "stay longer");
    const card = extensionCard(ask.surfaces);
    assert.ok(card, "the extension card is offered");
    const cardText = JSON.stringify(card.a2uiMessages);
    for (const label of ["Added nights", "New checkout", "Added amount", "Due date for the added period"]) {
      assert.ok(cardText.includes(label), `the card shows ${label}`);
    }
    assert.equal(contractOf(f, offerId).extensionRequest, undefined, "nothing is requested before the card's button");
    assert.equal(contractOf(f, offerId).contractVersion, before.contractVersion, "the contract is unchanged before sending");
    assert.ok(diagnostics.some((event) => event.stage === "application_operation" && event.toolName === "propose_extension" && event.succeeded === true), "the preview tool ran and succeeded");

    // The card's own button sends the request, on a cold restore.
    const requested = successOf(await coldApp(f, threadId).app.handleEventAsync(threadId, buttonNamed(card, ASSISTANT_CONFIRM_ACTION_EVENT)), "request extension");
    assert.equal(requested.messages[0], GUEST_EXTENSION_COPY.requested, "the reply says the extension is requested");
    const awaiting = contractOf(f, offerId);
    assert.equal(awaiting.extensionRequest?.status, "awaiting_operator", "the request awaits the Operator");
    assert.equal(awaiting.dates.checkOut, before.dates.checkOut, "the stay is unchanged until the Operator approves");
    assert.equal(cardOpen(f, threadId), false, "the card closes once requested");
    const shown = confirmationContent(f.environment.contractApp.getArtifact(awaiting.contractId, f.environment.guestPrincipal()), threadId, "/bookings/x", "");
    assert.ok(shown.extension?.requested, "the booking screen shows the requested extension");
    assert.equal(shown.extension?.requested?.facts.addedNights, awaiting.extensionRequest?.addedNights, "the requested facts are the card's");

    // The Operator approves in the back office; the booking screen then shows the new checkout, and the appended period.
    f.environment.extensions.approveExtension(awaiting.contractId, { id: awaiting.parties.operator.id, role: "operator", tenantId: awaiting.tenantId }, awaiting.extensionRequest!.extensionId);
    const approved = contractOf(f, offerId);
    assert.equal(approved.dates.checkOut, awaiting.extensionRequest!.newCheckOut, "the new checkout is in force after approval");
    const outcome = confirmationContent(f.environment.contractApp.getArtifact(approved.contractId, f.environment.guestPrincipal()), threadId, "/bookings/x", "");
    assert.equal(outcome.extension?.outcome, "approved", "the booking screen shows the approved extension");
  } finally {
    f.close();
  }
});

test("Typed confirmations (yes, ok, confirm, go ahead) with an extension card open never send an extension request", async () => {
  const threadId = "g-0ee1000201";
  const f = extendedFixture();
  try {
    const { offerId } = await extendedToReservation(f, threadId);
    const before = contractOf(f, offerId);
    successOf(await coldApp(f, threadId, model()).app.handleTurn(threadId, STAY_LONGER_TEXT), "stay longer");
    for (const text of TYPED_CONFIRMATIONS) {
      const result = await coldApp(f, threadId, model()).app.handleTurn(threadId, text);
      assert.equal(result.ok, true, `"${text}" gets a reply, not a refusal code`);
      if (!result.ok) continue;
      assert.deepEqual(result.messages, [ASSISTANT_CONTROL_COPY.useCardButtons], `"${text}" is told to use the card`);
      assert.equal(contractOf(f, offerId).extensionRequest, undefined, `"${text}" sends no extension request`);
      assert.equal(contractOf(f, offerId).contractVersion, before.contractVersion, `"${text}" changes nothing`);
      assert.equal(cardOpen(f, threadId), true, `"${text}" leaves the card open`);
    }
  } finally {
    f.close();
  }
});

test("A Short Stay cannot be extended to 30 nights or more: the request is a tool_denial and no card is shown", async () => {
  const threadId = "g-0ee1000301";
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const shortFixture = datedFixture(model(), diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const shortBooking = await journeyToReservation(shortFixture, threadId);
    assert.equal(JSON.stringify(shortBooking.a2uiMessages).includes(EXTENSION_OPEN_EVENT), false, "a Short Stay's booking surface has no extension action");
    const ask = successOf(await wireDatedApp(shortFixture.environment, model(), diagnostics).app.handleTurn(threadId, STAY_LONGER_TEXT), "stay longer on a Short Stay");
    assert.deepEqual(ask.messages, [GUEST_EXTENSION_COPY.notExtended], "the refusal is the guest sentence");
    assert.equal(extensionCard(ask.surfaces), undefined, "no card for a Short Stay");
    assert.ok(diagnostics.some((event) => event.stage === "application_operation" && event.toolName === "propose_extension" && event.succeeded === false), "the refused tool call is recorded as a denial");
  } finally {
    shortFixture.close();
  }
});

test("A support request such as \"the water is off\" never offers the extension card", async () => {
  const threadId = "g-0ee1000401";
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = extendedFixture(diagnostics, () => CLOCK);
  try {
    await extendedToReservation(f, threadId);
    const result = successOf(await coldRecording(f, threadId, diagnostics).app.handleTurn(threadId, SUPPORT_TEXT), "report a problem");
    assert.equal(extensionCard(result.surfaces), undefined, "no extension card for a support request");
    assert.equal(diagnostics.some((event) => event.toolName === "propose_extension"), false, "the extension tool is not called for support");
  } finally {
    f.close();
  }
});

test("An extension card is refused while a Notice to End is in force, with the guest sentence", async () => {
  const threadId = "g-0ee1000501";
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = extendedFixture(diagnostics, () => CLOCK);
  try {
    const { offerId } = await extendedToReservation(f, threadId);
    recordVerifiedAccess(f, contractOf(f, offerId).reservationId);
    f.environment.noticeToEnd.giveNotice(contractOf(f, offerId).contractId, f.environment.guestPrincipal());
    const ask = successOf(await coldRecording(f, threadId, diagnostics).app.handleTurn(threadId, STAY_LONGER_TEXT), "stay longer after notice");
    assert.deepEqual(ask.messages, [GUEST_EXTENSION_COPY.noticeInForce], "the refusal names the notice");
    assert.equal(extensionCard(ask.surfaces), undefined, "no card while notice is in force");
    assert.equal(contractOf(f, offerId).extensionRequest, undefined, "no request is recorded");
  } finally {
    f.close();
  }
});

test("The extension tool is preview-only and the Extend your stay event opens the same card", async () => {
  const threadId = "g-0ee1000601";
  const f = extendedFixture([], () => CLOCK);
  try {
    const { booking, offerId } = await extendedToReservation(f, threadId);
    const press = successOf(await coldApp(f, threadId, model()).app.handleEventAsync(threadId, { name: EXTENSION_OPEN_EVENT, surfaceId: booking.surfaceId, context: { surfaceId: booking.surfaceId, threadId } }), "extend your stay");
    assert.ok(extensionCard(press.surfaces), "the button opens the extension card");
    assert.equal(contractOf(f, offerId).extensionRequest, undefined, "opening the card records nothing");
  } finally {
    f.close();
  }
});
