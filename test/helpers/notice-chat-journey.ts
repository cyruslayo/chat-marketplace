import assert from "node:assert/strict";
import type { AssistantDiagnosticEvent } from "../../apps/local-guest/src/assistant/assistant-runtime.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { SqliteCheckInSupportStore } from "../../domains/shortlet/src/checkin-support.js";
import type { BookingContract } from "../../domains/shortlet/src/card-payment.js";
import { openNodeSqliteDatabase } from "../../packages/platform-core/src/node-sqlite-database.js";
import { coldApp, EMAIL, JOURNEY_SCRIPT, PHONE, successOf, tap, type Surface } from "./assistant-stage-journey.js";
import { extendUnit } from "./demo-extended-journey.js";
import { datedFixture, firstButtonAction, LIVE_LIKE_CLOCK, scriptedPlanner, type DatedFixture, type ScriptedTurn } from "./guest-date-fixtures.js";

// Issue 18: the Extended Stay chat journey and its cold-restore helpers, shared by test/notice-to-end-chat.test.ts and the chat
// captures (.scratch/guest-ui-consistency/capture-18.ts). Every event runs on a new app over the same store (ADR 0106).

export const CHECK_IN = "2026-10-28";
export const NIGHTS = 31;
export const EXT_TEXT = "Ikoyi for 31 nights, 2 guests from 28 October 2026";
export const EXT_SLOTS = { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: CHECK_IN, nights: NIGHTS, guests: 2 };
export const NOTICE_TEXT = "I want to end my stay early";
// Issue 18 AC3 / support: a problem with the stay is support, never a notice request (ADR 0106 closed intents).
export const SUPPORT_TEXT = "the water is off";
export const OPEN_EVENT = "shortlet.assistant.open-notice";
export const TYPED_CONFIRMATIONS = ["yes", "ok", "confirm", "go ahead"] as const;
export const PLANNER_TOOL = { name: "propose_notice_to_end", args: {} } as const;

export const SCRIPT: Record<string, ScriptedTurn> = {
  ...JOURNEY_SCRIPT,
  [EXT_TEXT]: { slots: EXT_SLOTS, search: { ...EXT_SLOTS } },
  [NOTICE_TEXT]: { slots: {}, intents: ["end_booking"], tool: PLANNER_TOOL, replyAfterTool: { kind: "propose_action", references: ["propose_notice_to_end"] } },
  // The planner is scripted to try the notice tool on a support request: the pack must not offer it under support (ADR 0106).
  [SUPPORT_TEXT]: { slots: {}, intents: ["support"], tool: PLANNER_TOOL, replyAfterTool: { kind: "support_guidance", references: [] } },
  ...Object.fromEntries(TYPED_CONFIRMATIONS.map((text) => [text, { slots: {}, intents: ["support"], reply: "support_guidance" as const }])),
};

export function model() {
  return scriptedPlanner(SCRIPT).client;
}

export function extendedFixture(diagnostics: AssistantDiagnosticEvent[] = []): DatedFixture {
  const f = datedFixture(model(), diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  const seeded = f.environment.unitRepository.findAll()[0]!;
  f.environment.unitRepository.save(extendUnit(seeded, {}));
  return f;
}

/** The chat journey to a confirmed Extended Stay, every step on a cold restore (ADR 0106). Returns the booking surface. */
export async function extendedToReservation(f: DatedFixture, threadId: string): Promise<{ readonly booking: Surface; readonly offerId: string }> {
  const search = successOf(await f.app.handleTurn(threadId, EXT_TEXT), "search");
  const detail = await tap(f, threadId, search.surfaces[0]!, "View");
  const draft = await tap(f, threadId, detail.surfaces[0]!, "Request to Book");
  const phoneAsk = await tap(f, threadId, draft.surfaces[0]!, "Review request");
  const phoneSave = firstButtonAction(phoneAsk.surfaces[0]!);
  const saved = successOf(await coldApp(f, threadId).app.handleEventAsync(threadId, { ...phoneSave, context: { ...phoneSave.context, contactValue: PHONE } }), "save phone");
  const sent = await tap(f, threadId, saved.surfaces[0]!, "Send booking request");
  const requestId = sent.surfaces[0]!.surfaceId.split(":").at(-1)!;
  f.environment.simulateOperatorAcceptance(requestId);
  const offer = coldApp(f, threadId).app.getState(threadId)!.surfaces[0]!;
  const offerId = offer.surfaceId.split(":").at(-1)!;
  const payment = await tap(f, threadId, offer, "Accept offer");
  const checkout = await tap(f, threadId, payment.surfaces[0]!, "Start checkout");
  const emailAsk = firstButtonAction(checkout.surfaces[0]!);
  const emailSaved = successOf(await coldApp(f, threadId).app.handleEventAsync(threadId, { ...emailAsk, context: { ...emailAsk.context, contactValue: EMAIL } }), "save email");
  const returned = await tap(f, threadId, emailSaved.surfaces[0]!, "Payment return");
  // An Extended Stay's first Period Payment confirms the stay on return (ADR 0092): there is no separate verification step.
  if (/Reservation confirmed/i.test(returned.surfaces[0]?.summary ?? "")) return { booking: returned.surfaces[0]!, offerId };
  const verifying = await tap(f, threadId, returned.surfaces[0]!, "Verify payment");
  const confirmed = await tap(f, threadId, verifying.surfaces[0]!, "Confirm payment");
  assert.match(confirmed.surfaces[0]!.summary ?? "", /Reservation confirmed/i);
  return { booking: confirmed.surfaces[0]!, offerId };
}

export function contractOf(f: DatedFixture, offerId: string): BookingContract {
  const contract = f.environment.cardPaymentApp.getBookingContract(offerId);
  assert.ok(contract, "the confirmed contract is readable");
  return contract;
}

/** Records Verified Access for the Reservation in the shared check-in store (ADR 0061, ADR 0092). */
export function recordVerifiedAccess(f: DatedFixture, reservationId: string): void {
  const database = openNodeSqliteDatabase(f.databasePath!);
  try {
    new SqliteCheckInSupportStore(database).save(reservationId, {
      schedule: null, window: null, evidence: [],
      result: { reservationId, status: "verified_access", verifiedAt: `${CHECK_IN}T10:00:00.000Z`, protectionWindowStartsAt: `${CHECK_IN}T10:00:00.000Z` },
      complaints: [],
    });
  } finally {
    database.close();
  }
}

/** The event of the first button on a surface whose action has `name` (the same walk as `firstButtonAction`). */
export function buttonNamed(surface: Surface, name: string): { readonly name: string; readonly surfaceId: string; readonly context: Record<string, unknown> } {
  const found: { name: string; surfaceId: string; context: Record<string, unknown> }[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const record = node as Record<string, unknown>;
    const event = (record.action as { event?: { name?: unknown; context?: unknown } } | undefined)?.event;
    if (event && event.name === name && event.context !== null && typeof event.context === "object") found.push({ name, surfaceId: surface.surfaceId, context: event.context as Record<string, unknown> });
    Object.values(record).forEach(walk);
  };
  walk(surface.a2uiMessages);
  assert.ok(found[0], `the surface has a button for ${name}`);
  return found[0]!;
}

export function cardOpen(f: DatedFixture, threadId: string): boolean {
  const state = coldApp(f, threadId).app.getState(threadId);
  return (state?.surfaces ?? []).some((surface) => surface.surfaceId.includes(":pending-action:"));
}

