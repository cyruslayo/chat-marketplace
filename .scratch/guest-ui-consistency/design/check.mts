// Renders each design artboard at its frame size (light and dark), reports clipped content and small targets, saves PNGs to renders/. Run from the repo root: npx tsx .scratch/guest-ui-consistency/design/check.mts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launchRealBrowser } from "../../../test/helpers/chrome-devtools.js";

const root = import.meta.dirname;
const project = root;
const out = join(root, "renders");
mkdirSync(out, { recursive: true });
const canvas = JSON.parse(readFileSync(join(project, "canvas.json"), "utf8")) as { boards: Record<string, { w: number; h: number }> };
const only = process.argv.slice(2);
const browser = await launchRealBrowser();
const tab = await browser.createTab();
try {
  for (const [file, { w, h }] of Object.entries(canvas.boards)) {
    if (file === "DarkMode.dc.html" || (only.length && !only.some((name) => file.startsWith(name)))) continue;
    for (const theme of ["light", "dark"]) {
      await tab.setCssViewport(w, h);
      await tab.navigate(pathToFileURL(join(project, file)).href);
      await tab.waitForFunction("document.readyState === 'complete'", 10_000);
      const report = await tab.evaluate<{ need: number; wide: number; tooSmall: string[] }>(`(() => {
        const el = document.querySelector('.sl');
        if (${theme === "dark"}) el.classList.add('dark');
        const small = [...el.querySelectorAll('a, button, input')].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && (r.height < 44 && !n.closest('.compare') && n.type !== 'file'); }).map((n) => n.textContent.trim().slice(0, 24) || n.getAttribute('aria-label'));
        return { need: el.scrollHeight, wide: el.scrollWidth - el.clientWidth, tooSmall: small };
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      writeFileSync(join(out, `${file.replace(".dc.html", "")}-${theme}.png`), await tab.captureScreenshot());
      if (theme === "light") console.log(`${file}: frame ${h}, content ${report.need}${report.need > h ? "  CLIPPED" : ""}${report.wide > 0 ? `  WIDE ${report.wide}` : ""}${report.tooSmall.length ? `  small targets: ${report.tooSmall.join(" | ")}` : ""}`);
    }
  }
} finally {
  await tab.close();
  await browser.close();
}
