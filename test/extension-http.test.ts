import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createGuestRequestHandler, GUEST_COMMERCE_COMPOSITION } from "../apps/local-guest/src/guest-server.js";
import { EXTENSION_OPEN_EVENT } from "../apps/web-agent/src/booking-contract-a2ui.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { EXT_TEXT, model, extendedFixture, buttonNamed } from "./helpers/notice-chat-journey.js";
import { firstButtonAction } from "./helpers/guest-date-fixtures.js";

// Monthly-stays issue 09 AC7 over the real HTTP routes (/api/turn, /api/event), as the browser sends them. "Extend your stay" on the
// confirmed booking opens the extension card, and the card's Request extension button records the request. The typed route to the
// card (the planner tool) is covered on a cold app in test/extension-chat.test.ts; see the issue's Comments for the HTTP gap.

type Surface = { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[]; readonly summary?: string };
type Result = { readonly ok: boolean; readonly code?: string; readonly message?: string; readonly surfaces: readonly Surface[] };
const PHONE = "+234 801 234 5678";
const EMAIL = "guest@example.com";

test("Extend your stay opens the extension card over the HTTP routes, and Request extension records the request", async () => {
  const f = extendedFixture();
  const handler = createGuestRequestHandler({
    environment: f.environment, modelClient: model(), conciergeMode: "assistant-offline", commerce: GUEST_COMMERCE_COMPOSITION.disabled,
    landingBinaryAssets: { read: () => new Uint8Array([1]) },
  });
  const server: Server = createServer((req, res) => { void handler.handle(req, res); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const home = await fetch(`${base}/`);
    const cookie = (home.headers.get("set-cookie") ?? "").split(";")[0]!;
    const threadId = "g-0ee1000e01";
    const post = async (path: "/api/turn" | "/api/event", body: Record<string, unknown>): Promise<Result> => {
      const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie, origin: base }, body: JSON.stringify({ threadId, ...body }) });
      return (await response.json()) as Result;
    };
    const tap = (surface: Surface): Promise<Result> => {
      const action = firstButtonAction(surface as never);
      return post("/api/event", { name: action.name, surfaceId: action.surfaceId, context: action.context });
    };
    const ok = (result: Result, step: string): Result => { assert.equal(result.ok, true, `${step}: ${result.code ?? ""} ${result.message ?? ""}`); return result; };

    const search = ok(await post("/api/turn", { text: EXT_TEXT }), "search");
    const detail = ok(await tap(search.surfaces[0]!), "View");
    const draft = ok(await tap(detail.surfaces[0]!), "Request to Book");
    const phoneAsk = ok(await tap(draft.surfaces[0]!), "Review request");
    const phoneSave = firstButtonAction(phoneAsk.surfaces[0] as never);
    const saved = ok(await post("/api/event", { name: phoneSave.name, surfaceId: phoneSave.surfaceId, context: { ...phoneSave.context, contactValue: PHONE } }), "save phone");
    const sent = ok(await tap(saved.surfaces[0]!), "Send booking request");
    f.environment.simulateOperatorAcceptance(sent.surfaces[0]!.surfaceId.split(":").at(-1)!);
    const state = (await (await fetch(`${base}/api/state?threadId=${threadId}`, { headers: { cookie } })).json()) as { readonly surfaces: readonly Surface[] };
    const payment = ok(await tap(state.surfaces[0]!), "Accept offer");
    const checkout = ok(await tap(payment.surfaces[0]!), "Start checkout");
    const emailAsk = firstButtonAction(checkout.surfaces[0] as never);
    const emailSaved = ok(await post("/api/event", { name: emailAsk.name, surfaceId: emailAsk.surfaceId, context: { ...emailAsk.context, contactValue: EMAIL } }), "save email");
    const booking = ok(await tap(emailSaved.surfaces[0]!), "Payment return").surfaces[0]!;
    assert.match(booking.summary ?? "", /Reservation confirmed/i);

    // "Extend your stay" on the confirmed booking: the named event with the booking surface id opens the card.
    const opened = ok(await post("/api/event", { name: EXTENSION_OPEN_EVENT, surfaceId: booking.surfaceId, context: { surfaceId: booking.surfaceId } }), "Extend your stay");
    const card = opened.surfaces.find((surface) => surface.surfaceId.includes(":pending-action:"));
    assert.ok(card, "the extension card opens from the booking");

    // Request extension on the card records the request: a versioned step the Operator decides.
    const action = buttonNamed(card as never, ASSISTANT_CONFIRM_ACTION_EVENT);
    ok(await post("/api/event", { name: action.name, surfaceId: action.surfaceId, context: action.context }), "Request extension");
    const contractId = booking.surfaceId.split(":booking:")[1]!;
    const contract = f.environment.contractApp.getArtifact(contractId, f.environment.guestPrincipal());
    assert.equal(contract.facts.extension?.status, "awaiting_operator", "the request is recorded and shown as awaiting the Operator");
  } finally {
    server.close();
    f.close();
  }
});
