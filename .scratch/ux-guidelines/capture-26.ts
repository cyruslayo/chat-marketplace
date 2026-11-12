// Issue 26 captures: the Operator inbox and request detail at 320/390/768/1280, light and dark.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { startSignedInOperator } from "../../test/helpers/operator-session.js";

const out = join(import.meta.dirname, "screenshots", "26");
mkdirSync(out, { recursive: true });
const findings: string[] = [];
const f = await startSignedInOperator();
const request = f.server.environment.createDemoIncomingBookingRequest({ guestId: "ux26-guest", guestName: "Guest 1", checkIn: "2026-09-10", checkOut: "2026-09-13" });
const browser = await launchRealBrowser();
const tab = await browser.createTab();
const cookiePairs = f.session.cookie.split(";").map((part) => part.trim().split("="));
const metrics = async () => tab.evaluate<{ height: number; overflow: number; small: readonly { tag: string; text: string; width: number; height: number }[] }>(`(() => {
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
try {
  for (const [name, value] of cookiePairs) if (name !== undefined && value !== undefined) await tab.setCookie(name, value, f.session.base);
  const pages = [["inbox", "/operator/requests"], ["detail", `/operator/requests/${request.facts.requestId}`]];
  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 390, 768, 1280]) {
      for (const [name, path] of pages) {
        if (!path.endsWith("/")) {
          const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
          await size(900);
          await tab.navigate(`${f.session.base}${path}`);
          await tab.waitForSelector("main#main-content", 10_000);
          await tab.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
          await new Promise((resolve) => setTimeout(resolve, 400));
          const m = await metrics();
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
  }
} finally {
  await tab.close();
  await browser.close();
  await f.close();
}
writeFileSync(join(out, "findings-26.txt"), `${findings.join("\n")}\n`);
