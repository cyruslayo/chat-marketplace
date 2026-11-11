// Issue 15 captures: the standard-page skip link, focused, at 320/390/768/1280 in light and dark.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const out = join(import.meta.dirname, "screenshots", "15");
mkdirSync(out, { recursive: true });
const findings: string[] = [];
const fixture = await restartFixture();
const browser = await launchRealBrowser();
const tab = await browser.createTab();
try {
  const url = `${fixture.base}/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`;
  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 390, 768, 1280]) {
      const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
      await size(900);
      await tab.navigate(url);
      await tab.waitForSelector("main#main-content", 10_000);
      await tab.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
      await tab.pressKey("Tab");
      await new Promise((resolve) => setTimeout(resolve, 400));
      const metrics = await tab.evaluate<{ height: number; overflow: number; small: readonly { tag: string; text: string; width: number; height: number }[] }>(`(() => {
        const height = document.documentElement.scrollHeight;
        const overflow = document.documentElement.scrollWidth - innerWidth;
        const small = [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')]
          .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), width: Math.round(r.width), height: Math.round(r.height) }; })
          .filter((entry) => entry.width > 0 && entry.height > 0 && (entry.width < 44 || entry.height < 44));
        return { height, overflow, small };
      })()`);
      await size(Math.min(metrics.height, 4000));
      await new Promise((resolve) => setTimeout(resolve, 200));
      writeFileSync(join(out, `skip-link-${theme}-${width}.png`), await tab.captureScreenshot());
      const line = `skip-link ${theme} ${width}: height ${metrics.height}${metrics.overflow > 0 ? ` HORIZONTAL OVERFLOW ${metrics.overflow}px` : " no horizontal overflow"}`;
      findings.push(line);
      for (const entry of metrics.small) findings.push(`  UNDER 44px: ${entry.tag} "${entry.text}" ${entry.width}x${entry.height}`);
      console.log(line);
    }
  }
} finally {
  await tab.close();
  await browser.close();
  await fixture.close();
}
writeFileSync(join(out, "findings-15.txt"), `${findings.join("\n")}\n`);
