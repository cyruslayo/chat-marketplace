// Issue 24 captures: a long chat thread at 320/390/768/1280, light and dark, with overflow and 44px findings.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const out = join(import.meta.dirname, "screenshots", "24");
mkdirSync(out, { recursive: true });
const findings: string[] = [];
const fixture = await restartFixture();
await fixture.advance("discovery");
const browser = await launchRealBrowser();
const tab = await browser.createTab();
const [cookieName, cookieValue] = fixture.cookie.split("=", 2);
try {
  await tab.setCookie(cookieName!, cookieValue!, fixture.base);
  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 390, 768, 1280]) {
      const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
      await size(900);
      await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
      await tab.waitForFunction("document.readyState === 'complete'", 10_000);
      await tab.evaluate(`(() => {
        document.documentElement.setAttribute('data-theme', '${theme}');
        const transcript = document.querySelector('#transcript');
        for (let index = 0; index < 20; index += 1) {
          const turn = document.createElement('article');
          turn.className = index % 2 === 0 ? 'turn user' : 'turn assistant';
          const bubble = document.createElement('div');
          bubble.className = 'bubble';
          bubble.textContent = 'Earlier message ' + (index + 1) + '. A longer line so the turn has a realistic height at every width.';
          turn.appendChild(bubble);
          transcript.appendChild(turn);
        }
        const turns = [...transcript.querySelectorAll('.turn')];
        turns.forEach((turn, index) => turn.classList.toggle('turn--deferred', index < turns.length - 6));
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const m = await tab.evaluate<{ height: number; overflow: number; deferred: number; small: readonly { tag: string; text: string; width: number; height: number }[] }>(`(() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return {
          height: document.documentElement.scrollHeight,
          overflow: document.documentElement.scrollWidth - innerWidth,
          deferred: document.querySelectorAll('#transcript .turn--deferred').length,
          small: [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')].filter(visible)
            .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName.toLowerCase(), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), width: Math.round(r.width), height: Math.round(r.height) }; })
            .filter((entry) => entry.width < 44 || entry.height < 44)
            .filter((entry) => !(entry.tag === "input" && entry.width <= 1 && entry.height <= 1)),
        };
      })()`);
      await size(Math.min(m.height, 4000));
      await new Promise((resolve) => setTimeout(resolve, 200));
      writeFileSync(join(out, `long-thread-${theme}-${width}.png`), await tab.captureScreenshot());
      const line = `long-thread ${theme} ${width}: height ${m.height} deferred ${m.deferred}${m.overflow > 0 ? ` HORIZONTAL OVERFLOW ${m.overflow}px` : " no horizontal overflow"}`;
      findings.push(line);
      for (const entry of m.small) findings.push(`  UNDER 44px: ${entry.tag} "${entry.text}" ${entry.width}x${entry.height}`);
      console.log(line);
    }
  }
} finally {
  await tab.close();
  await browser.close();
  await fixture.close();
}
writeFileSync(join(out, "findings-24.txt"), `${findings.join("\n")}\n`);
