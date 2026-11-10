// Issue 60 captures: a stale discovery card and a disabled control at 320/390/768/1280, light and dark.
// The states are the ones the client sets on a refusal: `data-status="stale"` on the active workspace and `aria-disabled="true"` on the
// refused control. The control is the first visible View control (the workspace is collapsed on phones and the results render inline).
// Usage: NODE_ENV=test tsx .scratch/guest-ui-consistency/capture-60.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { restartFixture } from "../../test/helpers/guest-restart.js";

const out = join(import.meta.dirname, "screenshots", "60");
mkdirSync(out, { recursive: true });
const PROMPT = "I need an apartment in Ikoyi from 10 Sept for 3 nights for 2 people";
const IKOYI_TITLE = "Luxury 2-Bedroom Apartment in Old Ikoyi";
const MIN_TARGET_PX = 44;

const fixture = await restartFixture();
const browser = await launchRealBrowser();
let failures = 0;
try {
  for (const width of [320, 390, 768, 1280]) {
    const tab = await browser.createTab();
    try {
      const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
      await size(900);
      await tab.navigate(`${fixture.base}/`);
      await tab.evaluate(`(() => { const input = document.getElementById("composer-input"); input.value = ${JSON.stringify(PROMPT)}; document.getElementById("composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); })()`);
      await tab.waitForText(IKOYI_TITLE, 30_000);
      for (const theme of ["light", "dark"] as const) {
        await tab.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
        // Disabled control: the first visible View control carries the refusal's aria-disabled state.
        await tab.evaluate(`(() => {
          const visible = [...document.querySelectorAll('button')].filter((button) => button.getBoundingClientRect().height > 0);
          const target = visible.find((button) => (button.textContent || '').toLowerCase().includes('view')) ?? visible[0];
          if (target) { target.setAttribute('data-capture-target', '1'); target.setAttribute('aria-disabled', 'true'); }
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const disabled = await tab.evaluate<{ height: number; overflow: number }>(`(() => { const button = document.querySelector('button[data-capture-target="1"]'); return { height: button ? button.getBoundingClientRect().height : 0, overflow: document.documentElement.scrollWidth - innerWidth }; })()`);
        writeFileSync(join(out, `disabled-${theme}-${width}.png`), await tab.captureScreenshot());
        console.log(`disabled-${theme}-${width}: target ${disabled.height}px${disabled.overflow > 0 ? ` HORIZONTAL OVERFLOW ${disabled.overflow}px` : ""}`);
        if (disabled.height < MIN_TARGET_PX || disabled.overflow > 0) failures++;

        // Stale card: the active workspace carries the stale status the client sets on a stale refusal.
        await tab.evaluate(`(() => { const button = document.querySelector('button[data-capture-target="1"]'); if (button) { button.removeAttribute('aria-disabled'); button.removeAttribute('data-capture-target'); } const workspace = document.getElementById('active-workspace'); if (workspace) workspace.dataset.status = 'stale'; })()`);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const stale = await tab.evaluate<{ overflow: number }>(`({ overflow: document.documentElement.scrollWidth - innerWidth })`);
        writeFileSync(join(out, `stale-${theme}-${width}.png`), await tab.captureScreenshot());
        console.log(`stale-${theme}-${width}:${stale.overflow > 0 ? ` HORIZONTAL OVERFLOW ${stale.overflow}px` : " ok"}`);
        if (stale.overflow > 0) failures++;
        await tab.evaluate(`(() => { const workspace = document.getElementById('active-workspace'); if (workspace) delete workspace.dataset.status; })()`);
      }
    } finally {
      await tab.close();
    }
  }
} finally {
  await browser.close();
  await fixture.close();
}
if (failures > 0) {
  console.error(`${failures} capture check(s) failed`);
  process.exitCode = 1;
}
