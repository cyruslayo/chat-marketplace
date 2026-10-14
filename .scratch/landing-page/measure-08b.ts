// Section offsets at 390 px for the issue 08 sub-task B crops (reduced motion, light theme).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGuestEnvironment } from "../../apps/local-guest/src/fixture.js";
import { startLocalGuestServer } from "../../apps/local-guest/src/guest-server.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";

const directory = mkdtempSync(join(tmpdir(), "landing-measure-"));
const server = startLocalGuestServer({ port: 0, environment: new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") }) });
const port = await server.listen();
const browser = await launchRealBrowser({ headless: true });
const tab = await browser.createTab();
await tab.setReducedMotion(true);
try {
  await tab.setViewport(390, 844);
  await tab.setExtraHeaders({ cookie: "shortlet_theme=light" });
  await tab.navigate(`http://127.0.0.1:${port}/welcome`);
  await tab.waitForFunction("document.readyState === 'complete'", 10_000);
  const out = await tab.evaluate<unknown>(`(() => {
    const top = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().top + scrollY) : null; };
    const bottom = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().bottom + scrollY) : null; };
    return { how: top('#how'), money: top('#money'), moneyBottom: bottom('#money'), docHeight: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth };
  })()`);
  console.log(JSON.stringify(out));
} finally {
  await tab.close().catch(() => undefined);
  await browser.close({ releaseLock: false }).catch(() => undefined);
  await server.close();
  browser.releaseLock();
}
