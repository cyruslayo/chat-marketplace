import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { writeCapture } from "./helpers/write-capture.js";
import { join } from "node:path";
import test from "node:test";
import { launchRealBrowser, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { startTaskRailServer } from "./helpers/assistant-task-rail.js";
import { renderGuestShellHtml } from "../apps/local-guest/src/guest-server.js";

const SCREENSHOT_DIR = join(".scratch", "multi-domain-platform", "screenshots", "26");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

test("AC4: light and dark themes come from tokens only", () => {
  const css = readFileSync(join("apps", "web", "src", "shortlet-foundations.css"), "utf8");
  const start = css.indexOf("/* Shell task rail (slice 26)");
  const end = css.indexOf("a.ui-chip", start);
  assert.ok(start >= 0 && end > start, "the slice 26 kit block is present");
  const block = css.slice(start, end);
  assert.doesNotMatch(block, /#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(/, "the task rail kit styles use tokens only");

  const shell = renderGuestShellHtml();
  const shellStart = shell.indexOf("/* Slice 26: the task rail");
  assert.ok(shellStart >= 0, "the shell has the slice 26 chrome rules");
  const shellEnd = shell.indexOf("main {", shellStart);
  assert.ok(shellEnd > shellStart);
  assert.doesNotMatch(shell.slice(shellStart, shellEnd), /#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(/, "the shell chrome rules use tokens only");
});

test("AC3: captures at 320, 390, 768, 1280 show no horizontal overflow and targets of at least 44px", {
  skip: process.env.SHORTLET_TASK_RAIL_BROWSER !== "1" ? "Run explicitly with SHORTLET_TASK_RAIL_BROWSER=1 to avoid competing with the full Chromium suite" : false,
}, async () => {
  const fixture = await startTaskRailServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector("#composer-input");
    await tab.focus("#composer-input");
    await tab.insertText("I need a place in Ikoyi for 4 nights for 2 guests");
    await tab.pressKey("Enter");
    await tab.waitForSelector("#active-workspace .stay-card", 15_000);
    await tab.focus("#composer-input");
    await tab.insertText("start a new task");
    await tab.pressKey("Enter");
    await tab.waitForFunction("!document.querySelector('#task-rail').hidden", 15_000);

    for (const theme of ["light", "dark"]) {
      await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      for (const width of [320, 390, 768, 1280]) {
        await (width < 768 ? tab.setViewport(width, 900) : tab.setCssViewport(width, 900));
        await tab.evaluate("document.fonts.ready.then(() => true)");
        const result = await tab.evaluate<{ overflow: number; small: string[] }>(`(() => {
          const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          const small = Array.from(document.querySelectorAll('a, button, input, select, textarea, summary'))
            .filter((el) => {
              if (el.type === 'hidden' || el.type === 'file' || el.closest('[hidden]') || el.classList.contains('skip-link') || el.classList.contains('sr-only')) return false;
              const r = el.getBoundingClientRect();
              const s = getComputedStyle(el);
              return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && (r.height < 44 || r.width < 44);
            })
            .map((el) => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 28) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height));
          return { overflow, small };
        })()`);
        assert.equal(result.overflow <= 0, true, `${theme}-${width}: no horizontal overflow`);
        assert.deepEqual(result.small, [], `${theme}-${width}: every control is at least 44px`);
        await writeCapture(join(SCREENSHOT_DIR, `task-rail-${theme}-${width}.png`), await tab.captureScreenshot());
      }
    }
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});
