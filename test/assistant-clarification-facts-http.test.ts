import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createGuestRequestHandler, GUEST_COMMERCE_COMPOSITION } from "../apps/local-guest/src/guest-server.js";
import type { AssistantDiagnosticEvent } from "../apps/local-guest/src/assistant/assistant-runtime.js";
import type { AssistantModelClient } from "../apps/local-guest/src/assistant/assistant-model.js";
import { datedFixture, LIVE_LIKE_CLOCK, scriptedPlanner, type DatedFixture, type ScriptedTurn } from "./helpers/guest-date-fixtures.js";
import { storedAssistantContext } from "./helpers/stay-length-fixtures.js";

// Issue 20 AC6 (ADR 0106 cold restore, issue 20): the landing chip over the HTTP routes, demo off. Every request is served by a NEW
// handler, so a new assistant runtime is built over the same store for each request (a cold restore between requests).

const CHIP = "Ikoyi, 2 months from 5 Jan, relocating";
const JAN_5 = "2027-01-05";

/** Serves one request on a new handler (a new runtime over the same environment), then closes the server. */
async function coldRequest<T>(f: DatedFixture, planner: AssistantModelClient, diagnostics: AssistantDiagnosticEvent[], run: (base: string) => Promise<T>): Promise<T> {
  const handler = createGuestRequestHandler({
    environment: f.environment, modelClient: planner, conciergeMode: "assistant-offline", commerce: GUEST_COMMERCE_COMPOSITION.disabled,
    landingBinaryAssets: { read: () => new Uint8Array([1]) }, onAssistantDiagnostic: (event) => diagnostics.push(event),
  });
  const server: Server = createServer((req, res) => { void handler.handle(req, res); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

test("AC6 The landing chip 'Ikoyi, 2 months from 5 Jan, relocating' sent through the landing handoff (demo off, cold restore between requests) then '2 guests' searches 60 nights with the '(2 months)' show-back", async () => {
  const turns: Record<string, ScriptedTurn> = {
    [CHIP]: { slots: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: JAN_5, nights: 60 }, reply: "clarify_stay" },
    "2 guests": { slots: { guests: 2 }, search: { city: "Lagos", neighbourhood: "Old Ikoyi", checkIn: JAN_5, nights: 60, guests: 2 } },
  };
  const planner = scriptedPlanner(turns).client;
  const diagnostics: AssistantDiagnosticEvent[] = [];
  const f = datedFixture(planner, diagnostics, { clock: LIVE_LIKE_CLOCK, stagingGuest: true });
  try {
    const cookie = await coldRequest(f, planner, diagnostics, async (base) => (await fetch(`${base}/`)).headers.get("set-cookie")?.split(";")[0] ?? "");
    assert.match(cookie, /shortlet_guest_session=/, "the guest has a session");

    const started = await coldRequest(f, planner, diagnostics, (base) => fetch(`${base}/welcome/start`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", origin: base, cookie },
      body: new URLSearchParams({ message: CHIP }).toString(),
    }));
    const location = started.headers.get("location") ?? "";
    const threadId = new URL(location, "http://guest.test").searchParams.get("threadId");
    assert.ok(threadId, `the handoff opens a conversation: ${started.status} ${location}`);

    const turn = await coldRequest(f, planner, diagnostics, async (base) => {
      const response = await fetch(`${base}/api/turn`, {
        method: "POST", headers: { "content-type": "application/json", cookie, origin: base },
        body: JSON.stringify({ threadId, text: "2 guests" }),
      });
      return (await response.json()) as { readonly ok: boolean; readonly messages?: readonly string[]; readonly code?: string; readonly criteria?: { readonly when?: { readonly label?: string } } };
    });
    assert.equal(turn.ok, true, `the party turn succeeds: ${turn.code ?? ""}`);
    assert.match(turn.criteria?.when?.label ?? "", /60 nights \(2 months\)$/, "the criteria strip shows the months");
    assert.equal(storedAssistantContext(f.environment, threadId).checkOut, "2027-03-06", "the search runs 60 nights from 5 Jan");
    assert.equal(storedAssistantContext(f.environment, threadId).nights, 60, "the stored stay is 60 nights");
  } finally { f.close(); }
});
