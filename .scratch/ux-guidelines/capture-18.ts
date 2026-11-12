// Issue 18 captures: the discovery workspace, its comparison and the standard search page at 320/390/768/1280,
// light and dark, with overflow and sub-44px control findings.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const out = join(import.meta.dirname, "screenshots", "18");
mkdirSync(out, { recursive: true });
const findings: string[] = [];
const fixture = await restartFixture();
const [first] = fixture.environment.unitRepository.findAll();
if (first) fixture.environment.unitRepository.save({ ...first, id: "unit-lagos-ikoyi-003", title: "Garden 2-Bedroom Apartment in Old Ikoyi" });
await fixture.advance("discovery");
const browser = await launchRealBrowser();
const tab = await browser.createTab();
const [cookieName, cookieValue] = fixture.cookie.split("=", 2);
const metrics = async (): Promise<{ height: number; overflow: number; small: readonly { tag: string; text: string; width: number; height: number }[] }> => tab.evaluate(`(() => {
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
  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 390, 768, 1280]) {
      const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
      await size(900);
      await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
      await tab.waitForFunction("document.readyState === 'complete'", 10_000);
      await tab.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      let m = await metrics();
      await size(Math.min(m.height, 4000));
      await new Promise((resolve) => setTimeout(resolve, 200));
      writeFileSync(join(out, `chat-discovery-${theme}-${width}.png`), await tab.captureScreenshot());
      findings.push(`chat-discovery ${theme} ${width}: height ${m.height}${m.overflow > 0 ? ` HORIZONTAL OVERFLOW ${m.overflow}px` : " no horizontal overflow"}`);
      for (const entry of m.small) findings.push(`  UNDER 44px: ${entry.tag} "${entry.text}" ${entry.width}x${entry.height}`);
      if (await tab.clickButton("See both side by side")) {
        await tab.waitForSelector("#active-workspace .ui-compare", 10_000);
        m = await metrics();
        await size(Math.min(m.height, 4000));
        await new Promise((resolve) => setTimeout(resolve, 200));
        writeFileSync(join(out, `chat-compare-${theme}-${width}.png`), await tab.captureScreenshot());
        findings.push(`chat-compare ${theme} ${width}: height ${m.height}${m.overflow > 0 ? ` HORIZONTAL OVERFLOW ${m.overflow}px` : " no horizontal overflow"}`);
        for (const entry of m.small) findings.push(`  UNDER 44px: ${entry.tag} "${entry.text}" ${entry.width}x${entry.height}`);
      }
      await tab.navigate(`${fixture.base}/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`);
      await tab.waitForSelector("main.ui-page", 10_000);
      await tab.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      m = await metrics();
      await size(Math.min(m.height, 4000));
      await new Promise((resolve) => setTimeout(resolve, 200));
      writeFileSync(join(out, `search-page-${theme}-${width}.png`), await tab.captureScreenshot());
      findings.push(`search-page ${theme} ${width}: height ${m.height}${m.overflow > 0 ? ` HORIZONTAL OVERFLOW ${m.overflow}px` : " no horizontal overflow"}`);
      for (const entry of m.small) findings.push(`  UNDER 44px: ${entry.tag} "${entry.text}" ${entry.width}x${entry.height}`);
      console.log(`issue 18 ${theme} ${width} done`);
    }
  }
} finally {
  await tab.close();
  await browser.close();
  await fixture.close();
}
writeFileSync(join(out, "findings-18.txt"), `${findings.join("\n")}\n`);
