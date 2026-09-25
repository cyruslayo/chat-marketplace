import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { startLocalGuestServer, type LocalGuestServerHandle } from "../apps/local-guest/src/guest-server.js";
import { launchRealBrowser, type RealBrowserInstance, type RealBrowserTab } from "./helpers/chrome-devtools.js";
import { startImageFixtureServer, type ImageFixtureServer } from "./helpers/image-fixtures.js";

const PHOTO_URLS = [
  "https://images.example/synthetic-cover.png",
  "https://images.example/synthetic-living-room.png",
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
  readonly unitDescription: string;
  readonly imageFixture: ImageFixtureServer;
  close(): Promise<void>;
}

async function createContext(width: number): Promise<Context> {
  const directory = mkdtempSync(join(tmpdir(), "listing-photos-browser-"));
  const environment = new LocalGuestEnvironment({ databasePath: join(directory, "guest.sqlite") });
  const unit = environment.unitRepository.findAll()[0];
  assert.ok(unit);
  const unitDescription = "A bright, quiet apartment with a spacious living room, reliable power, secure parking, natural light, and room for a comfortable short stay.\n\nGuests have easy access to the surrounding neighbourhood and practical everyday amenities.";
  environment.unitRepository.save({ ...unit, description: unitDescription, bathrooms: 2, photoUrls: PHOTO_URLS });
  const server = startLocalGuestServer({ port: 0, environment });
  const imageFixture = startImageFixtureServer();
  let browser: RealBrowserInstance | undefined;
  let tab: RealBrowserTab | undefined;
  let disposeImageInterception: (() => Promise<void>) | undefined;
  let closed = false;
  const cleanup = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      try { await disposeImageInterception?.(); } catch {}
      try { await tab?.close(); } catch {}
      try { await browser?.close({ releaseLock: false }); } catch {}
      try { await server.close(); } catch {}
      try { await imageFixture.close(); } catch {}
      rmSync(directory, { recursive: true, force: true });
    } finally {
      browser?.releaseLock();
    }
  };
  try {
    await imageFixture.listen();
    const port = await server.listen();
    const base = `http://127.0.0.1:${port}`;
    browser = await launchRealBrowser({ headless: true });
    tab = await browser.createTab();
    await tab.setViewport(width, 800);
    disposeImageInterception = await tab.interceptRequests((url) => imageFixture.respond(url));
    return {
      directory,
      environment,
      server,
      browser,
      tab,
      base,
      unitId: unit.id,
      unitTitle: unit.title,
      unitDescription,
      imageFixture,
      close: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function waitForImageReadiness(tab: RealBrowserTab, expectedCount: number, description: string): Promise<void> {
  const expression = `(() => { const images = [...document.images]; return images.length === ${expectedCount} && images.every((img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0); })()`;
  try {
    await tab.waitForFunction(expression, 15000);
  } catch (error) {
    const diagnostics = await tab.evaluate(`(() => ({
      url: location.origin + location.pathname,
      images: [...document.images].map((img) => {
        try { const parsed = new URL(img.currentSrc || img.src, location.href); return { src: parsed.host + parsed.pathname, complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }; }
        catch { return { src: "[invalid-url]", complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }; }
      }),
      fallback: Boolean(document.querySelector('.photo-fallback')),
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }))()`).catch(() => ({ unavailable: true }));
    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
}

async function waitForBrokenImageFallback(tab: RealBrowserTab): Promise<void> {
  try {
    await tab.waitForFunction("Boolean([...document.querySelectorAll('.photo-fallback')].some((element) => element.textContent?.includes('Photo unavailable')))", 15000);
  } catch (error) {
    const diagnostics = await tab.evaluate(`(() => ({
      url: location.origin + location.pathname,
      images: [...document.images].map((img) => {
        try { const parsed = new URL(img.currentSrc || img.src, location.href); return { src: parsed.host + parsed.pathname, complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }; }
        catch { return { src: "[invalid-url]", complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }; }
      }),
      fallbackText: [...document.querySelectorAll('.photo-fallback')].map((element) => element.textContent ?? ""),
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }))()`).catch(() => ({ unavailable: true }));
    throw new Error(`Timed out waiting for broken-image fallback: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
}

async function sendSearch(context: Context): Promise<void> {
  await context.tab.navigate(`${context.base}/`);
  await context.tab.waitForSelector("#composer-input");
  await context.tab.evaluate(`(() => { const input = document.getElementById('composer-input'); input.value = 'I need an apartment in Lagos from 10 Sept for 2 nights for 2 people'; document.getElementById('composer').requestSubmit(); })()`);
  await context.tab.waitForText(context.unitTitle);
}

for (const width of [320, 390]) {
  test(`AC13/AC15/AC20/AC21 — photo discovery and broken-image fallback remain usable at ${width}px`, async () => {
    const context = await createContext(width);
    try {
      await sendSearch(context);
      await waitForImageReadiness(context.tab, 1, "the discovery primary image");
      const discovery = await context.tab.evaluate<{ readonly images: number; readonly src: string | null; readonly documentWidth: number }>("(() => ({ images: document.images.length, src: document.querySelector('img')?.getAttribute('src') || null, documentWidth: document.documentElement.scrollWidth }))()");
      assert.equal(discovery.images, 1);
      assert.equal(discovery.src, PHOTO_URLS[0]);
      assert.ok(discovery.documentWidth <= width);

      await context.tab.evaluate(`(() => { const image = document.querySelector('img'); if (!(image instanceof HTMLImageElement)) throw new Error('Primary listing image is missing'); image.src = ${JSON.stringify(context.imageFixture.brokenUrl)}; })()`);
      await waitForBrokenImageFallback(context.tab);
      const afterFailure = await context.tab.evaluate<{ readonly critical: boolean; readonly fallback: boolean; readonly fallbackBox: { readonly width: number; readonly height: number; readonly role: string | null; readonly name: string | null } | null; readonly documentWidth: number }>(`(() => { const box = document.querySelector('.photo-fallback'); const rect = box?.getBoundingClientRect(); return { critical: document.body.innerText.includes(${JSON.stringify(context.unitTitle)}), fallback: document.body.innerText.includes('Photo unavailable'), fallbackBox: box && rect ? { width: rect.width, height: rect.height, role: box.getAttribute('role'), name: box.getAttribute('aria-label') } : null, documentWidth: document.documentElement.scrollWidth }; })()`);
      assert.equal(afterFailure.critical, true);
      assert.equal(afterFailure.fallback, true);
      assert.ok(afterFailure.fallbackBox);
      assert.ok(afterFailure.fallbackBox.width >= 200 && afterFailure.fallbackBox.height >= 150, JSON.stringify(afterFailure.fallbackBox));
      assert.equal(afterFailure.fallbackBox.role, "img");
      assert.ok(afterFailure.fallbackBox.name?.includes(context.unitTitle));
      const accessibilityTree = await context.tab.getAccessibilityTree();
      const namedPhotoNodes = accessibilityTree.filter((node) => node.name.includes(context.unitTitle));
      assert.ok(accessibilityTree.some((node) => (node.role === "img" || node.role === "image") && node.name.includes(context.unitTitle) && /unavailable/i.test(node.name)), JSON.stringify(namedPhotoNodes));
      assert.ok(afterFailure.documentWidth <= width);

      await context.tab.navigate(`${context.base}/stays/${context.unitId}`);
      await context.tab.waitForText(context.unitTitle);
      await context.tab.evaluate("[...document.images].forEach((image) => image.scrollIntoView({ block: 'center' }))");
      await waitForImageReadiness(context.tab, 2, "the Unit-detail gallery");
      await context.tab.setOffline(true);
      const detail = await context.tab.evaluate<{ readonly images: number; readonly referrerPolicies: string[]; readonly documentWidth: number; readonly critical: boolean; readonly description: boolean; readonly bathrooms: boolean }>(`(() => ({ images: document.images.length, referrerPolicies: [...document.images].map((img) => img.referrerPolicy), documentWidth: document.documentElement.scrollWidth, critical: document.body.innerText.includes(${JSON.stringify(context.unitTitle)}) && document.body.innerText.includes('Price'), description: document.body.innerText.includes(${JSON.stringify(context.unitDescription)}), bathrooms: document.body.innerText.includes('Bathrooms: 2') }))()`);
      assert.equal(detail.images, 2);
      assert.deepEqual(detail.referrerPolicies, ["no-referrer", "no-referrer"]);
      assert.equal(detail.critical, true);
      assert.equal(detail.description, true);
      assert.equal(detail.bathrooms, true);
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
    await context.tab.waitForText("Photos are not available for this apartment yet.");
    const result = await context.tab.evaluate<{ readonly images: number; readonly overflow: boolean; readonly critical: boolean }>(`({ images: document.images.length, overflow: document.documentElement.scrollWidth > innerWidth, critical: document.body.innerText.includes('Price') && document.body.innerText.includes(${JSON.stringify(context.unitTitle)}) })`);
    assert.deepEqual(result, { images: 0, overflow: false, critical: true });
  } finally {
    await context.close();
  }
});
