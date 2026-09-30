// Captures full-page screenshots of the walkthrough pages at the plan's widths (320/390/768/1280), light scheme, and
// reports any horizontal overflow. Usage: tsx capture.ts name=url [name=url ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const out = join(import.meta.dirname, "screenshots");
mkdirSync(out, { recursive: true });
const pages = process.argv.slice(2).map((arg) => { const at = arg.indexOf("="); return [arg.slice(0, at), arg.slice(at + 1)] as const; });
const browser = await launchRealBrowser();
const tab = await browser.createTab();
try {
  for (const width of [320, 390, 768, 1280]) {
    for (const [name, url] of pages) {
      const size = (height: number) => width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height);
      await size(900);
      await tab.navigate(url);
      await tab.waitForFunction("document.readyState === 'complete'", 10_000);
      await tab.evaluate("document.documentElement.setAttribute('data-theme', 'light')");
      await new Promise((resolve) => setTimeout(resolve, 400));
      const { height, overflow } = await tab.evaluate<{ height: number; overflow: number }>("({ height: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth - innerWidth })");
      await size(Math.min(height, 4000));
      await new Promise((resolve) => setTimeout(resolve, 200));
      writeFileSync(join(out, `${name}-${width}.png`), await tab.captureScreenshot());
      console.log(`${name}-${width}: height ${height}${overflow > 0 ? ` HORIZONTAL OVERFLOW ${overflow}px` : ""}`);
    }
  }
} finally {
  await tab.close();
  await browser.close();
}
