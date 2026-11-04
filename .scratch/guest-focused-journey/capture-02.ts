import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";

const directory = join(import.meta.dirname, "screenshots", "02");
mkdirSync(directory, { recursive: true });
const fixture = await restartFixture();
const browser = await launchRealBrowser();
const findings: string[] = [];
try {
  for (const width of [320, 390, 768, 1280]) {
    for (const theme of ["light", "dark"]) {
      const tab = await browser.createTab();
      await tab.setViewport(width, 800);
      await tab.navigate(`${fixture.base}/`);
      await tab.focus("#composer-input");
      await tab.insertText("I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people");
      await tab.pressKey("Enter");
      await tab.waitForSelector("#active-workspace .stay-card", 10_000);
      if (!await tab.clickButton("View apartment")) throw new Error("View apartment missing");
      await tab.waitForSelector("#active-workspace .unit-detail-root", 10_000);
      await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      const result = await tab.evaluate<{ overflow: boolean; smallTargets: string[] }>(`(() => {
        const root = document.getElementById('active-workspace');
        const smallTargets = [...root.querySelectorAll('button, a, input, select, textarea')]
          .filter((control) => { const style = getComputedStyle(control); const box = control.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44); })
          .map((control) => { const box = control.getBoundingClientRect(); return (control.textContent?.trim() || control.getAttribute('aria-label') || control.tagName) + ': ' + Math.round(box.width) + 'x' + Math.round(box.height); });
        return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, smallTargets };
      })()`);
      writeFileSync(join(directory, `${width}-${theme}.png`), await tab.captureScreenshot());
      findings.push(`${width} ${theme}: overflow=${result.overflow}; under-44px=${JSON.stringify(result.smallTargets)}`);
      await tab.close();
    }
  }
} finally {
  await browser.close();
  await fixture.close();
}
writeFileSync(join(directory, "findings.txt"), findings.join("\n") + "\n");
findings.forEach((finding) => process.stdout.write(finding + "\n"));
