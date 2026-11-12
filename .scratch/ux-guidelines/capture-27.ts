// Issue 27 captures: the Extended Stay offer and payment screens at 320/390/768/1280, light and dark.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { addDays, withDemoGuest, createDemoDraft, discloseDemoDraft, offerFromDemoRequest, acceptDemoOffer, type DemoGuestContext } from "../../test/helpers/demo-extended-journey.js";

const out = join(import.meta.dirname, "screenshots", "27");
mkdirSync(out, { recursive: true });
const findings: string[] = [];
const CHECK_IN = "2026-09-10";
const SEASON = "standard";
void SEASON;
await withDemoGuest({}, async (context: DemoGuestContext) => {
  const draft = createDemoDraft(context, { checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, 180) });
  const requestId = discloseDemoDraft(context, draft.draftId);
  const offerId = offerFromDemoRequest(context, requestId);
  const server = startLocalGuestServer({ port: 0, environment: context.guest });
  const base = `http://127.0.0.1:${await server.listen()}`;
  // The guest session cookie the page routes require (as a returning browser would hold).
  const home = await fetch(base);
  const cookie = home.headers.get("set-cookie")?.split(";")[0] ?? "";
  await home.text();
  const offerPath = `/payments/offers/${encodeURIComponent(offerId)}`;
  const offerPage = await fetch(`${base}${offerPath}`, { headers: { cookie, accept: "text/html" } });
  const offerHtml = await offerPage.text();
  findings.push(`offer page status ${offerPage.status}; schedule ${/Payment schedule/.test(offerHtml) ? "shown" : "missing"}; periods ${(offerHtml.match(/Billing Period \d+:/g) ?? []).length}`);
  const browser = await launchRealBrowser();
  const tab = await browser.createTab();
  try {
    for (const theme of ["light", "dark"] as const) {
      for (const width of [320, 390, 768, 1280]) {
        for (const [name, path] of [["offer", offerPath]] as const) {
          const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
          await size(900);
          await tab.setCookie(cookie.split("=", 2)[0]!, cookie.split("=", 2)[1]!, base);
          await tab.navigate(`${base}${path}`);
          await tab.waitForFunction("document.readyState === 'complete'", 10_000);
          await tab.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
          await new Promise((resolve) => setTimeout(resolve, 400));
          const m = await tab.evaluate<{ height: number; overflow: number; small: readonly { tag: string; text: string; width: number; height: number }[] }>(`(() => {
            const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            return {
              height: document.documentElement.scrollHeight,
              overflow: document.documentElement.scrollWidth - innerWidth,
              small: [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')].filter(visible)
                .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), width: Math.round(r.width), height: Math.round(r.height) }; })
                .filter((entry) => entry.width < 44 || entry.height < 44)
                .filter((entry) => !(entry.tag === "input" && entry.width <= 1 && entry.height <= 1)),
            };
          })()`);
          await size(Math.min(m.height, 4000));
          await new Promise((resolve) => setTimeout(resolve, 200));
          writeFileSync(join(out, `${name}-${theme}-${width}.png`), await tab.captureScreenshot());
          const line = `${name} ${theme} ${width}: height ${m.height}${m.overflow > 0 ? ` HORIZONTAL OVERFLOW ${m.overflow}px` : " no horizontal overflow"}`;
          findings.push(line);
          for (const entry of m.small) findings.push(`  UNDER 44px: ${entry.tag} "${entry.text}" ${entry.width}x${entry.height}`);
          console.log(line);
        }
      }
    }
  } finally {
    await tab.close();
    await browser.close();
    await server.close();
  }
  void acceptDemoOffer;
});
writeFileSync(join(out, "findings-27.txt"), `${findings.join("\n")}\n`);
