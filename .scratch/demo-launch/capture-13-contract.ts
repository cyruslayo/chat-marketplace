import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { driveExtendedStayToConfirmed } from "./drive-13.js";

// Demo-launch issue 13 (AC6): the confirmed Extended Stay contract shows the demo Notice to End terms, on the standalone
// contract page and in the chat. Light theme, 320/390/768/1280, overflow and 44px target checks. Stubbed provider only.
const output = ".scratch/demo-launch/screenshots/13";
mkdirSync(output, { recursive: true });
const { fixture, contractPath } = await driveExtendedStayToConfirmed((line) => console.log(line));
assert.ok(contractPath, "the confirmed contract route is reached");
const findings: string[] = [];
const browser = await launchRealBrowser();
try {
  const tab = await browser.createTab();
  await tab.setExtraHeaders({ cookie: fixture.cookie });
  for (const [name, route] of [["contract-page", contractPath], ["contract-chat", `/?threadId=${fixture.threadId}`]] as const) {
    for (const width of [320, 390, 768, 1280]) {
      await tab.setJavaScriptEnabled(name === "contract-chat");
      await tab.setViewport(width, 900);
      await tab.navigate(`${fixture.base}${route}`);
      await tab.waitForFunction("document.readyState === 'complete'", 15_000);
      await tab.evaluate("document.fonts.ready.then(() => true)");
      await tab.evaluate("document.documentElement.dataset.theme = 'light'");
      const height = await tab.evaluate<number>("Math.max(document.documentElement.scrollHeight, 900)");
      await tab.setViewport(width, Math.min(4000, height));
      const fits = await tab.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth");
      if (!fits) findings.push(`${name}/${width}: horizontal overflow`);
      await tab.waitForSelector('.confirmed-screen', 15_000);
      const small = await tab.evaluate<string[]>("[...document.querySelectorAll('.confirmed-screen button, .confirmed-screen a, .confirmed-screen input, .confirmed-screen select, .confirmed-screen textarea, .confirmed-screen summary')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44 && !el.closest('[hidden]') && el.type !== 'hidden'; }).map(el => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40))");
      if (small.length) findings.push(`${name}/${width}: controls under 44px: ${small.join(", ")}`);
      const text = await tab.evaluate<string>("document.body.innerText");
      if (!text.includes("Notice to End")) findings.push(`${name}/${width}: Notice to End wording not shown`);
      if (/counsel[- ]approved|approved by counsel/i.test(text)) findings.push(`${name}/${width}: counsel approval claimed`);
      writeFileSync(`${output}/${name}-light-${width}.png`, await tab.captureScreenshot());
      console.log(`${name}/${width}: captured`);
    }
  }
} finally {
  await browser.close();
  await fixture.close();
}
writeFileSync(`${output}/contract-findings.txt`, findings.length ? `${findings.join("\n")}\n` : "No horizontal overflow, no controls below 44px, Notice to End wording shown, no counsel approval claim.\n");
assert.deepEqual(findings, []);
