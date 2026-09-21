import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer, type LocalGuestServerHandle } from "../apps/local-guest/src/guest-server.js";
import { launchRealBrowser, type RealBrowserInstance, type RealBrowserTab } from "./helpers/chrome-devtools.js";

const PHOTO_URLS = [
  "https://images.example/synthetic-cover.jpg",
  "https://images.example/synthetic-living-room.jpg",
];

interface Context {
  readonly directory: string;
  readonly environment: LocalGuestEnvironment;
  readonly server: LocalGuestServerHandle;
  readonly browser: RealBrowserInstance;
  readonly tab: RealBrowserTab;
  readonly base: string;
  readonly unitId: string;
  readonly unitTitle: string;
  close(): Promise<void>;
}

async function createContext(width: number): Promise<Context> {
  const directory = mkdtempSync(join(tmpdir(), "listing-photos-browser-"));
  const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
  const unit = environment.unitRepository.findAll()[0];
  assert.ok(unit);
  environment.unitRepository.save({ ...unit, photoUrls: PHOTO_URLS });
  const server = startLocalGuestServer({ port: 0, environment });
  const browser = await launchRealBrowser({ headless: true });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const tab = await browser.createTab();
  await tab.setViewport(width, 800);
  return {
    directory,
    environment,
    server,
    browser,
    tab,
    base,
    unitId: unit.id,
    unitTitle: unit.title,
    async close() {
      await tab.close();
      await browser.close();
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function sendSearch(context: Context): Promise<void> {
  await context.tab.navigate(`${context.base}/`);
  await context.tab.waitForSelector("#composer-input");
  await context.tab.evaluate(`(() => { const input = document.getElementById('composer-input'); input.value = 'I need an apartment in Lagos for 2 nights for 2 people'; document.getElementById('composer').requestSubmit(); })()`);
  await context.tab.waitForText(context.unitTitle);
}

for (const width of [320, 390]) {
  test(`AC13/AC15/AC20/AC21 — photo discovery and broken-image fallback remain usable at ${width}px`, async () => {
    const context = await createContext(width);
    try {
      await sendSearch(context);
      const discovery = await context.tab.evaluate<{ readonly images: number; readonly src: string | null; readonly documentWidth: number }>("(() => ({ images: document.images.length, src: document.querySelector('img')?.getAttribute('src') || null, documentWidth: document.documentElement.scrollWidth }))()");
      assert.equal(discovery.images, 1);
      assert.equal(discovery.src, PHOTO_URLS[0]);
      assert.ok(discovery.documentWidth <= width);

      await context.tab.evaluate("document.querySelector('img')?.dispatchEvent(new Event('error'))");
      const afterFailure = await context.tab.evaluate<{ readonly critical: boolean; readonly fallback: boolean; readonly documentWidth: number }>(`({ critical: document.body.innerText.includes(${JSON.stringify(context.unitTitle)}), fallback: document.body.innerText.includes('Photo unavailable'), documentWidth: document.documentElement.scrollWidth })`);
      assert.equal(afterFailure.critical, true);
      assert.equal(afterFailure.fallback, true);
      assert.ok(afterFailure.documentWidth <= width);

      await context.tab.navigate(`${context.base}/stays/${context.unitId}`);
      await context.tab.waitForText(context.unitTitle);
      await context.tab.setOffline(true);
      const detail = await context.tab.evaluate<{ readonly images: number; readonly referrerPolicies: string[]; readonly documentWidth: number; readonly critical: boolean }>(`(() => ({ images: document.images.length, referrerPolicies: [...document.images].map((img) => img.referrerPolicy), documentWidth: document.documentElement.scrollWidth, critical: document.body.innerText.includes(${JSON.stringify(context.unitTitle)}) && document.body.innerText.includes('Price') }))()`);
      assert.equal(detail.images, 2);
      assert.deepEqual(detail.referrerPolicies, ["no-referrer", "no-referrer"]);
      assert.equal(detail.critical, true);
      assert.ok(detail.documentWidth <= width);
    } finally {
      await context.close();
    }
  });
}

test("AC14 — zero-photo conventional listing remains usable in Chromium", async () => {
  const context = await createContext(390);
  try {
    const unit = context.environment.unitRepository.findAll()[0];
    assert.ok(unit);
    context.environment.unitRepository.save({ ...unit, photoUrls: [] });
    await context.tab.navigate(`${context.base}/stays/${unit.id}`);
    await context.tab.waitForText("Photos are not available for this Unit yet.");
    const result = await context.tab.evaluate<{ readonly images: number; readonly overflow: boolean; readonly critical: boolean }>(`({ images: document.images.length, overflow: document.documentElement.scrollWidth > innerWidth, critical: document.body.innerText.includes('Price') && document.body.innerText.includes(${JSON.stringify(context.unitTitle)}) })`);
    assert.deepEqual(result, { images: 0, overflow: false, critical: true });
  } finally {
    await context.close();
  }
});
