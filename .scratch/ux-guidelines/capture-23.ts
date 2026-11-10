// Issue 23 captures: the chat unit detail with photos and a broken-photo variant at 320/390/768/1280, light and dark.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const out = join(import.meta.dirname, "screenshots", "23");
mkdirSync(out, { recursive: true });
const findings: string[] = [];
const fixture = await restartFixture();
const unit = fixture.environment.unitRepository.findById("unit-lagos-ikoyi-001");
if (unit) fixture.environment.unitRepository.save({ ...unit, photoUrls: ["https://photos.example.test/ikoyi-living.jpg", "https://photos.example.test/ikoyi-bedroom.jpg"] });
await fixture.advance("inspection");
const browser = await launchRealBrowser();
const tab = await browser.createTab();
const [cookieName, cookieValue] = fixture.cookie.split("=", 2);
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="), (character) => character.charCodeAt(0));
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
  await tab.setCookie(cookieName!, cookieValue!, fixture.base);
  const release = await tab.interceptRequests(async (url) => url.startsWith("https://photos.example.test/") ? { status: 200, headers: [{ name: "content-type", value: "image/png" }], body: png } : undefined);
  try {
    for (const theme of ["light", "dark"] as const) {
      for (const width of [320, 390, 768, 1280]) {
        const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
        await size(900);
        await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
        await tab.waitForSelector("#active-workspace .unit-detail-sheet", 15_000);
        await tab.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const m = await metrics();
        await size(Math.min(m.height, 4000));
        await new Promise((resolve) => setTimeout(resolve, 200));
        writeFileSync(join(out, `unit-detail-${theme}-${width}.png`), await tab.captureScreenshot());
        const line = `unit-detail ${theme} ${width}: height ${m.height}${m.overflow > 0 ? ` HORIZONTAL OVERFLOW ${m.overflow}px` : " no horizontal overflow"}`;
        findings.push(line);
        for (const entry of m.small) findings.push(`  UNDER 44px: ${entry.tag} "${entry.text}" ${entry.width}x${entry.height}`);
        console.log(line);
      }
    }
  } finally { await release(); }
} finally {
  await tab.close();
  await browser.close();
  await fixture.close();
}
writeFileSync(join(out, "findings-23.txt"), `${findings.join("\n")}\n`);
