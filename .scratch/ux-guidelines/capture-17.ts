// Issue 17 captures: the standard search page and the open chat workspace at 320/390/768/1280 in light and dark,
// with horizontal-overflow, sub-44px controls and sub-12px text findings.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const out = join(import.meta.dirname, "screenshots", "17");
mkdirSync(out, { recursive: true });
const findings: string[] = [];
const fixture = await restartFixture();
await fixture.advance("payment-ready");
const browser = await launchRealBrowser();
const tab = await browser.createTab();
const [cookieName, cookieValue] = fixture.cookie.split("=", 2);
try {
  await tab.setCookie(cookieName!, cookieValue!, fixture.base);
  const pages = [
    ["search-page", `${fixture.base}/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`],
    ["chat", `${fixture.base}/?threadId=${fixture.threadId}`],
  ] as const;
  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 390, 768, 1280]) {
      for (const [name, url] of pages) {
        const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
        await size(900);
        await tab.navigate(url);
        await tab.waitForFunction("document.readyState === 'complete'", 10_000);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await tab.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const metrics = await tab.evaluate<{ height: number; overflow: number; small: readonly { tag: string; text: string; width: number; height: number }[]; tiny: readonly { tag: string; text: string; size: string }[] }>(`(() => {
          const height = document.documentElement.scrollHeight;
          const overflow = document.documentElement.scrollWidth - innerWidth;
          const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const small = [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')]
            .filter(visible)
            .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), width: Math.round(r.width), height: Math.round(r.height) }; })
            .filter((entry) => entry.width < 44 || entry.height < 44)
            .filter((entry) => !(entry.tag === "input" && entry.width <= 1 && entry.height <= 1));
          const tiny = [...document.querySelectorAll('body *')]
            .filter((el) => visible(el) && el.children.length === 0 && (el.textContent || '').trim() !== '')
            .map((el) => { const px = parseFloat(getComputedStyle(el).fontSize); return { tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 40), px }; })
            .filter((entry) => entry.px < 12)
            .map((entry) => ({ tag: entry.tag, text: entry.text, size: entry.px.toFixed(1) + 'px' }));
          return { height, overflow, small, tiny };
        })()`);
        await size(Math.min(metrics.height, 4000));
        await new Promise((resolve) => setTimeout(resolve, 200));
        writeFileSync(join(out, `${name}-${theme}-${width}.png`), await tab.captureScreenshot());
        const line = `${name} ${theme} ${width}: height ${metrics.height}${metrics.overflow > 0 ? ` HORIZONTAL OVERFLOW ${metrics.overflow}px` : " no horizontal overflow"}`;
        findings.push(line);
        for (const entry of metrics.small) findings.push(`  UNDER 44px: ${entry.tag} "${entry.text}" ${entry.width}x${entry.height}`);
        for (const entry of metrics.tiny) findings.push(`  UNDER 12px: ${entry.tag} "${entry.text}" ${entry.size}`);
        console.log(line);
      }
    }
  }
} finally {
  await tab.close();
  await browser.close();
  await fixture.close();
}
writeFileSync(join(out, "findings-17.txt"), `${findings.join("\n")}\n`);
