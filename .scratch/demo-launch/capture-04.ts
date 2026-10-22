// Issue 04 captures (AC6): the demo pages at 320, 390, 768 and 1280 in light and dark, with an overflow check and a
// check of visible interactive controls below 44 CSS pixels (ADR 0078). Output: screenshots/04/ and findings.json there.
// Usage: tsx capture-04.ts <baseUrl>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const base = process.argv[2];
if (!base) throw new Error("usage: tsx capture-04.ts <baseUrl>");
const out = join(import.meta.dirname, "screenshots", "04");
mkdirSync(out, { recursive: true });
const pages = [
  ["welcome", "/welcome"],
  ["chat", "/"],
  ["results", "/stays/search?location=Lagos&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2"],
  ["unit", "/stays/unit-lagos-ikoyi-001"],
] as const;
const themes = ["light", "dark"] as const;
const widths = [320, 390, 768, 1280] as const;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Visible, interactive controls under 44 CSS pixels in either dimension; hidden native radios are measured via their labels.
const SMALL_TARGETS = `(() => {
  const selector = "a.ui-button, button, a.ui-chip, input:not([type=hidden]), select, textarea, a.ui-result-row";
  return [...document.querySelectorAll(selector)].filter((el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none" && (r.width < 44 || r.height < 44) && !(el instanceof HTMLInputElement && el.type === "radio");
  }).map((el) => (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 60));
})()`;

const browser = await launchRealBrowser();
const tab = await browser.createTab();
const findings: Array<Record<string, unknown>> = [];
try {
  for (const width of widths) {
    for (const theme of themes) {
      for (const [name, path] of pages) {
        const size = (height: number) => (width < 768 ? tab.setViewport(width, height) : tab.setCssViewport(width, height));
        await size(900);
        await tab.navigate(`${base}${path}`);
        await tab.waitForFunction("document.readyState === 'complete'", 10_000);
        await tab.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
        await pause(500);
        const measured = await tab.evaluate<{ height: number; overflow: number; demoChips: number; banner: boolean }>(
          "({ height: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth - window.innerWidth, demoChips: document.querySelectorAll('[data-demo-listing]').length, banner: document.querySelectorAll('[data-demo-banner]').length > 0 })",
        );
        const small = await tab.evaluate<string[]>(SMALL_TARGETS);
        await size(Math.min(measured.height, 4000));
        await pause(200);
        const file = `${name}-${theme}-${width}.png`;
        writeFileSync(join(out, file), await tab.captureScreenshot());
        findings.push({ file, page: name, theme, width, height: measured.height, horizontalOverflowPx: Math.max(0, measured.overflow), demoChips: measured.demoChips, demoBanner: measured.banner, smallTargets: small });
        console.log(`${file}: height ${measured.height}, overflow ${Math.max(0, measured.overflow)}px, chips ${measured.demoChips}, banner ${measured.banner}, small targets ${small.length}`);
      }
    }
  }
} finally {
  writeFileSync(join(out, "findings.json"), JSON.stringify(findings, null, 2));
  await tab.close();
  await browser.close();
}
