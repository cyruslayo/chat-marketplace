import assert from "node:assert/strict";
import test from "node:test";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

// Issue 23 (ADR 0078; guideline §7, §12): a broken image leaves the facts visible, and reserved image space means no
// layout shift on a throttled chat unit detail (the client's applyImageLayout path).

async function openUnitDetail(fixture: Awaited<ReturnType<typeof restartFixture>>, tab: Awaited<ReturnType<Awaited<ReturnType<typeof launchRealBrowser>>["createTab"]>>): Promise<void> {
  await tab.setViewport(390, 900);
  await tab.setExtraHeaders({ cookie: fixture.cookie });
  await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
  await tab.waitForSelector("#active-workspace .unit-detail-sheet", 15_000);
}

function addPhotos(fixture: Awaited<ReturnType<typeof restartFixture>>): void {
  const unit = fixture.environment.unitRepository.findById("unit-lagos-ikoyi-001");
  assert.ok(unit);
  fixture.environment.unitRepository.save({ ...unit, photoUrls: ["https://photos.example.test/ikoyi-living.jpg", "https://photos.example.test/ikoyi-bedroom.jpg"] });
}

test("AC3: A failed image request leaves the Unit name, facts and total visible", async () => {
  const fixture = await restartFixture();
  addPhotos(fixture);
  await fixture.advance("inspection");
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    const release = await tab.interceptRequests(async (url) => url.startsWith("https://photos.example.test/")
      ? { status: 500, headers: [{ name: "content-type", value: "text/plain" }], body: new Uint8Array() }
      : undefined);
    try {
      await openUnitDetail(fixture, tab);
      const text = await tab.evaluate<string>("document.querySelector('#active-workspace').innerText");
      assert.match(text, /Luxury 2-Bedroom Apartment in Old Ikoyi/);
      assert.match(text, /All-In Stay Total/);
      assert.match(text, /₦370,000/);
    } finally { await release(); }
  } finally { await browser.close(); await fixture.close(); }
});

test("AC4: Layout shift from images is zero on unit detail in a throttled real-Chrome run", async () => {
  const fixture = await restartFixture();
  addPhotos(fixture);
  await fixture.advance("inspection");
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setNetworkProfile("fast3g");
    // A slow but valid photo: the space must already be reserved while it loads.
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="), (character) => character.charCodeAt(0));
    const release = await tab.interceptRequests(async (url) => {
      if (!url.startsWith("https://photos.example.test/")) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return { status: 200, headers: [{ name: "content-type", value: "image/png" }], body: png };
    });
    await tab.setViewport(390, 900);
    await tab.setExtraHeaders({ cookie: fixture.cookie });
    await tab.navigate(`${fixture.base}/?threadId=${fixture.threadId}`);
    await tab.waitForSelector("#active-workspace .unit-detail-sheet", 15_000);
    await tab.evaluate("document.fonts.ready.then(() => true)");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const first = await tab.evaluate<number>("document.querySelector('#active-workspace .unit-detail-sheet').getBoundingClientRect().top");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const second = await tab.evaluate<number>("document.querySelector('#active-workspace .unit-detail-sheet').getBoundingClientRect().top");
    assert.ok(Math.abs(first - second) <= 1, `the detail stayed at ${first}, then ${second}`);
    const images = await tab.evaluate<readonly { width: boolean; height: boolean; high: boolean }[]>("[...document.querySelectorAll('#active-workspace img')].map((image) => ({ width: image.hasAttribute('width'), height: image.hasAttribute('height'), high: image.getAttribute('fetchpriority') === 'high' }))");
    assert.ok(images.length > 0, "the unit detail has images");
    for (const image of images) assert.equal(image.width && image.height, true, "every image reserves its space");
    assert.ok(images.filter((image) => image.high).length <= 1, "at most one high-priority image");
    await release();
  } finally { await browser.close(); await fixture.close(); }
});
