import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createGuestRequestHandler, GUEST_COMMERCE_COMPOSITION } from "../../apps/local-guest/src/guest-server.js";
import { model, extendedFixture, EXT_TEXT } from "./notice-chat-journey.js";
import { firstButtonAction, type DatedFixture } from "./guest-date-fixtures.js";
import type { Surface } from "./assistant-stage-journey.js";
import type { AssistantModelClient } from "../../apps/local-guest/src/assistant/assistant-model.js";

// Monthly-stays issues 09 and 18: the Node guest server's HTTP routes with ONE warm per-session runtime (no restart between
// requests), as the browser drives them. The cold-restore twins use a new LocalGuestApp over the same store instead.

export const WARM_PHONE = "+234 801 234 5678";
export const WARM_EMAIL = "guest@example.com";

export type HttpResult = { readonly ok: boolean; readonly code?: string; readonly message?: string; readonly messages?: readonly string[]; readonly surfaces: readonly Surface[]; readonly summary?: string };

export type WarmHttpSession = {
  readonly threadId: string;
  readonly post: (path: "/api/turn" | "/api/event", body: Record<string, unknown>) => Promise<HttpResult>;
  readonly state: () => Promise<{ readonly surfaces: readonly Surface[] }>;
  readonly tap: (surface: Surface, step: string) => Promise<HttpResult>;
  readonly close: () => void;
};

export function warmHttpFixture(): DatedFixture {
  return extendedFixture();
}

/** Starts the guest handler on a local port with the assistant enabled. The same handler serves every request (warm). */
export async function startWarmHttp(f: DatedFixture, threadId: string, planner: AssistantModelClient = model()): Promise<WarmHttpSession> {
  const handler = createGuestRequestHandler({
    environment: f.environment, modelClient: planner, conciergeMode: "assistant-offline", commerce: GUEST_COMMERCE_COMPOSITION.disabled,
    landingBinaryAssets: { read: () => new Uint8Array([1]) },
  });
  const server: Server = createServer((req, res) => { void handler.handle(req, res); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const home = await fetch(`${base}/`);
  const cookie = (home.headers.get("set-cookie") ?? "").split(";")[0]!;
  const post = async (path: "/api/turn" | "/api/event", body: Record<string, unknown>): Promise<HttpResult> => {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie, origin: base }, body: JSON.stringify({ threadId, ...body }) });
    return (await response.json()) as HttpResult;
  };
  const state = async () => (await (await fetch(`${base}/api/state?threadId=${threadId}`, { headers: { cookie } })).json()) as { readonly surfaces: readonly Surface[] };
  const tap = async (surface: Surface, step: string): Promise<HttpResult> => {
    const action = firstButtonAction(surface as never);
    return ok(await post("/api/event", { name: action.name, surfaceId: action.surfaceId, context: action.context }), step);
  };
  return { threadId, post, state, tap, close: () => server.close() };
}

export function ok(result: HttpResult, step: string): HttpResult {
  assert.equal(result.ok, true, `${step}: ${result.code ?? ""} ${result.message ?? ""}`);
  return result;
}

/** Books, pays and confirms an Extended Stay over the warm HTTP routes (the journey extension-http.test.ts walks). */
export async function bookedExtendedStayOverHttp(f: DatedFixture, threadId: string, planner: AssistantModelClient = model()): Promise<{ readonly session: WarmHttpSession; readonly booking: Surface; readonly offerId: string }> {
  const session = await startWarmHttp(f, threadId, planner);
  const search = ok(await session.post("/api/turn", { text: EXT_TEXT }), "search");
  const detail = await session.tap(search.surfaces[0]!, "View");
  const draft = await session.tap(detail.surfaces[0]!, "Request to Book");
  const phoneAsk = await session.tap(draft.surfaces[0]!, "Review request");
  const phoneSave = firstButtonAction(phoneAsk.surfaces[0] as never);
  const saved = ok(await session.post("/api/event", { name: phoneSave.name, surfaceId: phoneSave.surfaceId, context: { ...phoneSave.context, contactValue: WARM_PHONE } }), "save phone");
  const sent = await session.tap(saved.surfaces[0]!, "Send booking request");
  f.environment.simulateOperatorAcceptance(sent.surfaces[0]!.surfaceId.split(":").at(-1)!);
  const offered = await session.state();
  const offerId = offered.surfaces[0]!.surfaceId.split(":").at(-1)!;
  const payment = await session.tap(offered.surfaces[0]!, "Accept offer");
  const checkout = await session.tap(payment.surfaces[0]!, "Start checkout");
  const emailAsk = firstButtonAction(checkout.surfaces[0] as never);
  const emailSaved = ok(await session.post("/api/event", { name: emailAsk.name, surfaceId: emailAsk.surfaceId, context: { ...emailAsk.context, contactValue: WARM_EMAIL } }), "save email");
  const returned = await session.tap(emailSaved.surfaces[0]!, "Payment return");
  const booking = returned.surfaces[0]!;
  assert.match(booking.summary ?? "", /Reservation confirmed/i, "the stay is confirmed over HTTP");
  return { session, booking, offerId };
}
