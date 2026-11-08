// Monthly-stays issue 09 AC7: the chat extension card (the added period, its amount and due date) and the requested extension in the
// chat, at 320, 390, 768 and 1280, light and dark, with overflow and 44px target checks (ADR 0078). Synthetic demo data only; the
// assistant planner is the scripted model.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createGuestRequestHandler, GUEST_COMMERCE_COMPOSITION } from "../../apps/local-guest/src/guest-server.js";
import { ASSISTANT_CONFIRM_ACTION_EVENT } from "../../apps/local-guest/src/assistant/pending-action-a2ui.js";
import { buttonNamed, contractOf, extendedFixture, EXT_TEXT, model } from "../../test/helpers/notice-chat-journey.js";
import { EXTENSION_OPEN_EVENT } from "../../apps/web-agent/src/booking-contract-a2ui.js";
import { firstButtonAction } from "../../test/helpers/guest-date-fixtures.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const WIDTHS = [320, 390, 768, 1280];
const directory = ".scratch/guest-ui-consistency/screenshots/09";
mkdirSync(directory, { recursive: true });
const threadId = "g-0ee1000c01";
const PHONE = "+234 801 234 5678";
const EMAIL = "guest@example.com";

type Surface = { readonly surfaceId: string; readonly a2uiMessages: readonly unknown[]; readonly summary?: string };
type Result = { readonly ok: boolean; readonly code?: string; readonly message?: string; readonly surfaces: readonly Surface[] };

/** A chat step over the real HTTP routes, as the browser sends it (the first call binds the thread to the browser session). */
async function post(base: string, cookie: string, path: "/api/turn" | "/api/event", body: Record<string, unknown>): Promise<Result> {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie, origin: base }, body: JSON.stringify({ threadId, ...body }) });
  const result = (await response.json()) as Result;
  assert.equal(result.ok, true, `${path}: ${result.code ?? ""} ${result.message ?? ""}`);
  return result;
}

/** The first button of a surface, as the browser's button event (the same payload `firstButtonAction` builds). */
/** The button event a surface carries for one named action (the page sends the same payload). */
function buttonOf(surface: Surface, name: string): Record<string, unknown> {
  const action = buttonNamed(surface as never, name);
  return { name: action.name, surfaceId: action.surfaceId, context: action.context };
}

function tapOf(surface: Surface, label: string): Record<string, unknown> {
  const action = firstButtonAction(surface as never);
  console.log(`step: ${label}`);
  return { name: action.name, surfaceId: action.surfaceId, context: action.context };
}

const f = extendedFixture();
try {
  const handler = createGuestRequestHandler({
    environment: f.environment,
    modelClient: model(),
    conciergeMode: "assistant-offline",
    commerce: GUEST_COMMERCE_COMPOSITION.disabled,
    landingBinaryAssets: { read: () => new Uint8Array([1]) },
  });
  const server: Server = createServer((req, res) => { void handler.handle(req, res); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const home = await fetch(`${base}/`);
  const cookie = (home.headers.get("set-cookie") ?? "").split(";")[0]!;
  assert.ok(cookie, "a guest session cookie is issued");
  const path = `/?threadId=${threadId}`;

  // The journey to a confirmed Extended Stay, every step over HTTP (search, View, Request to Book, phone, send, offer, accept,
  // checkout, email, payment return). The Operator acceptance and Verified Access are recorded on the environment (ADR 0061, 0092).
  const search = await post(base, cookie, "/api/turn", { text: EXT_TEXT });
  const detail = await post(base, cookie, "/api/event", tapOf(search.surfaces[0]!, "View"));
  const draft = await post(base, cookie, "/api/event", tapOf(detail.surfaces[0]!, "Request to Book"));
  const phoneAsk = await post(base, cookie, "/api/event", tapOf(draft.surfaces[0]!, "Review request"));
  const phoneSave = firstButtonAction(phoneAsk.surfaces[0] as never);
  const saved = await post(base, cookie, "/api/event", { name: phoneSave.name, surfaceId: phoneSave.surfaceId, context: { ...phoneSave.context, contactValue: PHONE } });
  const sent = await post(base, cookie, "/api/event", tapOf(saved.surfaces[0]!, "Send booking request"));
  f.environment.simulateOperatorAcceptance(sent.surfaces[0]!.surfaceId.split(":").at(-1)!);
  const state = (await (await fetch(`${base}/api/state?threadId=${threadId}`, { headers: { cookie } })).json()) as { readonly surfaces: readonly Surface[] };
  const offer = state.surfaces[0]!;
  const offerId = offer.surfaceId.split(":").at(-1)!;
  const payment = await post(base, cookie, "/api/event", tapOf(offer, "Accept offer"));
  const checkout = await post(base, cookie, "/api/event", tapOf(payment.surfaces[0]!, "Start checkout"));
  const emailAsk = firstButtonAction(checkout.surfaces[0] as never);
  const emailSaved = await post(base, cookie, "/api/event", { name: emailAsk.name, surfaceId: emailAsk.surfaceId, context: { ...emailAsk.context, contactValue: EMAIL } });
  const returned = await post(base, cookie, "/api/event", tapOf(emailSaved.surfaces[0]!, "Payment return"));
  const booking = returned.surfaces[0]!;
  assert.match(booking.summary ?? "", /Reservation confirmed/i, "the Extended Stay is confirmed in the chat");

  const browser = await launchRealBrowser();
  try {
    let tab = await browser.createTab();
    await tab.setExtraHeaders({ cookie });
    const shoot = async (name: string, text: string) => {
      for (const theme of ["light", "dark"]) {
        for (const width of WIDTHS) {
          await tab.setViewport(width, 900);
          await tab.navigate(`${base}${path}`);
          try {
            await tab.waitForFunction(`document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`, 15_000);
          } catch (error) {
            console.error("page-text-at-timeout", (await tab.evaluate<string>("document.body.innerText")).split("\n").filter((line) => /otice|refund|owed|last night|checkout|give/i.test(line)).join(" | "));
            throw error;
          }
          await tab.waitForFunction("document.readyState === 'complete'", 10_000);
          await tab.evaluate("document.fonts.ready.then(() => true)");
          await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
          const height = await tab.evaluate<number>("Math.max(document.documentElement.scrollHeight, document.querySelector('main').scrollHeight + 240)");
          await tab.setViewport(width, Math.min(4000, height));
          assert.equal(await tab.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth"), true, `${name}/${theme}/${width}: overflow`);
          const small = await tab.evaluate<unknown[]>("[...document.querySelectorAll('main button, main a')].filter(el => el.getBoundingClientRect().width && (el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44)).map(el => el.textContent)");
          assert.deepEqual(small, [], `${name}/${theme}/${width}: target under 44px`);
          writeFileSync(`${directory}/${name}-${theme}-${width}.png`, await tab.captureScreenshot());
          console.log(`${name}/${theme}/${width}: overflow and 44px targets pass`);
        }
      }
    };
    // "Extend your stay" on the confirmed booking opens the card, which shows the added period before anything is sent (ADR 0092).
    const opened = await post(base, cookie, "/api/event", { name: EXTENSION_OPEN_EVENT, surfaceId: booking.surfaceId, context: { surfaceId: booking.surfaceId } });
    const card = opened.surfaces.find((surface) => surface.surfaceId.includes(":pending-action:"));
    assert.ok(card, "the extension card opens");
    await shoot("chat-extension-card", "Request extension");
    // Request extension on the card is the only confirmation (ADR 0074); the booking then shows the requested extension.
    await post(base, cookie, "/api/event", buttonOf(card, ASSISTANT_CONFIRM_ACTION_EVENT));
    // A fresh tab for the requested state: the card's workspace state from the first shots does not carry into it.
    tab = await browser.createTab();
    await tab.setExtraHeaders({ cookie });
    await shoot("chat-extension-requested", "Extension requested");
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
} finally {
  f.close();
}
