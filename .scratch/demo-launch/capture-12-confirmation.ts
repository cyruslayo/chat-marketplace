import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { driveExtendedStayToConfirmed } from "./drive-13.js";

// Demo-launch issue 12 (AC4): the confirmed Extended Stay page links to its payment schedule. Light and dark, 320/390/768/1280, overflow and 44px target checks. Stubbed provider only.
const output = ".scratch/demo-launch/screenshots/12";
mkdirSync(output, { recursive: true });
const { fixture, contractPath } = await driveExtendedStayToConfirmed((line) => console.log(line));
assert.ok(contractPath, "the confirmed contract route is reached");
const findings: string[] = [];
const browser = await launchRealBrowser();
try {
  const tab = await browser.createTab();
  await tab.setExtraHeaders({ cookie: fixture.cookie });
  for (const [name, route] of [["confirmation-page", contractPath]] as const) {
    for (const theme of ["light", "dark"] as const) for (const width of [320, 390, 768, 1280]) {
      await tab.setJavaScriptEnabled(name === "contract-chat");
      await tab.setViewport(width, 900);
      await tab.navigate(`${fixture.base}${route}`);
      await tab.waitForFunction("document.readyState === 'complete'", 15_000);
      await tab.evaluate("document.fonts.ready.then(() => true)");
      await tab.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
      const height = await tab.evaluate<number>("Math.max(document.documentElement.scrollHeight, 900)");
      await tab.setViewport(width, Math.min(4000, height));
      const fits = await tab.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth");
      if (!fits) findings.push(`${name}/${theme}/${width}: horizontal overflow`);
      await tab.waitForSelector('.confirmed-screen', 15_000);
      const small = await tab.evaluate<string[]>("[...document.querySelectorAll('.confirmed-screen button, .confirmed-screen a, .confirmed-screen input, .confirmed-screen select, .confirmed-screen textarea, .confirmed-screen summary')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44 && !el.closest('[hidden]') && el.type !== 'hidden'; }).map(el => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40))");
      if (small.length) findings.push(`${name}/${theme}/${width}: controls under 44px: ${small.join(", ")}`);
      const text = await tab.evaluate<string>("document.body.innerText");
      if (!text.includes("View payment schedule")) findings.push(`${name}/${theme}/${width}: payment schedule link not shown`);
      if (/counsel[- ]approved|approved by counsel/i.test(text)) findings.push(`${name}/${theme}/${width}: counsel approval claimed`);
      writeFileSync(`${output}/${name}-${theme}-${width}.png`, await tab.captureScreenshot());
      console.log(`${name}/${theme}/${width}: captured`);
    }
  }
} finally {
  await browser.close();
  await fixture.close();
}
writeFileSync(`${output}/confirmation-findings.txt`, findings.length ? `${findings.join("\n")}\n` : "No horizontal overflow, no controls below 44px, payment schedule link shown, no counsel approval claim.\n");
assert.deepEqual(findings, []);
