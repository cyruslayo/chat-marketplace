// Demo-launch issue 05, AC6: local walkthrough of the seeded demo apartments (ADR 0105, synthetic data only).
// Builds the demo inventory from apps/cloudflare/demo with the same importer the tests use, starts the local guest on it,
// and serves the demo photo bytes from apps/cloudflare/public/demo/photos through request interception, so no
// external host is contacted. Captures discovery and the unit-detail gallery at 320/390/768/1280, light and dark.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { restartFixture } from "../../test/helpers/guest-restart.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { JsonUnitRepository } from "../../domains/shortlet/src/browse.js";
import { importInventoryCsv, operatorResolverFromRepository } from "../../domains/shortlet/src/inventory-import.js";
import { publishUnit } from "../../domains/shortlet/src/onboarding.js";
import { demoOperatorRecords } from "../../scripts/demo-provision.js";

const root = process.cwd();
const output = join(root, ".scratch/demo-launch/screenshots/05");
const workDirectory = join(root, ".scratch/demo-launch/capture-05-inventory");
const photosDirectory = join(root, "apps/cloudflare/public/demo/photos");
const clock = () => new Date("2026-10-22T12:00:00.000Z");
const PHOTO_PREFIX = "https://demo.example.test/demo/photos/";

mkdirSync(output, { recursive: true });
rmSync(workDirectory, { recursive: true, force: true });
mkdirSync(workDirectory, { recursive: true });
const inventoryPath = join(workDirectory, "inventory.json");
const units = new JsonUnitRepository(inventoryPath);
const operator = demoOperatorRecords(readFileSync(join(root, "apps/cloudflare/demo/operators.csv"), "utf8"))[0]!.operator;
const csv = readFileSync(join(root, "apps/cloudflare/demo/inventory.csv"), "utf8").replaceAll("https://demo-origin.invalid", "https://demo.example.test");
const imported = importInventoryCsv(csv, {
  repository: units,
  operatorResolver: operatorResolverFromRepository({ findById: (id: string) => (id === operator.id ? operator : null) }),
  tenantId: "tenant-staging",
  clock,
});
assert.equal(imported.invalid, 0, JSON.stringify(imported.errors));
for (const unit of units.findAll()) publishUnit(units, unit.id, { clock });

const fixture = await restartFixture({ demo: true, deployment: "staging", inventoryPath });
fixture.setTime("2026-10-22T12:00:00.000Z");
const browser = await launchRealBrowser();
const findings: string[] = [];
const smallTargets = `[...document.querySelectorAll('a, button, input, select, textarea, summary')].filter((el) => { if (el.type === 'hidden' || el.type === 'file' || el.closest('[hidden]') || el.classList.contains('skip-link') || el.classList.contains('sr-only')) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && (r.height < 43.5 || r.width < 43.5); }).map((el) => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 28) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height))`;

try {
  const tab = await browser.createTab();
  await tab.setExtraHeaders({ cookie: fixture.cookie });
  const stopIntercept = await tab.interceptRequests(async (url) => {
    if (!url.startsWith(PHOTO_PREFIX)) return undefined;
    const relative = url.slice(PHOTO_PREFIX.length).split("?")[0]!;
    const file = join(photosDirectory, relative);
    if (!file.startsWith(photosDirectory) || !existsSync(file)) return { status: 404, headers: [], body: new Uint8Array() };
    return { status: 200, headers: [{ name: "content-type", value: "image/jpeg" }, { name: "cache-control", value: "no-store" }], body: new Uint8Array(readFileSync(file)) };
  });
  await tab.setViewport(1280, 900);
  await tab.navigate(fixture.base);
  await tab.waitForSelector("#composer-input", 15_000);
  const ask = async (text: string) => {
    await tab.focus("#composer-input");
    await tab.insertText(text);
    await tab.pressKey("Enter");
  };
  await ask("I need an apartment in Lagos for 30 nights for two people.");
  await new Promise((resolve) => setTimeout(resolve, 500));
  await ask("10 Nov");
  await new Promise((resolve) => setTimeout(resolve, 500));
  await ask("2 guests");
  await tab.waitForSelector("#active-workspace .stay-card", 15_000);

  const cardCount = await tab.evaluate<number>("document.querySelectorAll('#active-workspace .stay-card').length");
  assert.ok(cardCount >= 6, `discovery shows the six Lagos demo units, found ${cardCount}`);
  const cardPhotos = await tab.evaluate<number>("[...document.querySelectorAll('#active-workspace .stay-card img')].filter((img) => img.src.includes('/demo/photos/') && img.complete && img.naturalWidth > 0).length");
  assert.ok(cardPhotos >= cardCount, `every discovery card shows a loaded demo photo (${cardPhotos} of ${cardCount})`);

  const captureState = async (name: string) => {
    for (const theme of ["light", "dark"] as const) {
      for (const width of [320, 390, 768, 1280]) {
        await tab.setViewport(width, 900);
        await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        await tab.evaluate("document.fonts.ready.then(() => true)");
        await new Promise((resolve) => setTimeout(resolve, 300));
        const height = await tab.evaluate<number>("document.documentElement.scrollHeight");
        await tab.setViewport(width, Math.min(4_000, Math.max(800, height)));
        const audit = await tab.evaluate<{ overflow: number; small: string[] }>(`({ overflow: document.documentElement.scrollWidth - innerWidth, small: ${smallTargets} })`);
        const label = `${name}-${theme}-${width}`;
        if (audit.overflow > 0) findings.push(`${label}: horizontal overflow ${audit.overflow}px`);
        if (audit.small.length > 0) findings.push(`${label}: controls below 44px (${audit.small.length}): ${audit.small.slice(0, 4).join("; ")}`);
        writeFileSync(join(output, `${label}.png`), await tab.captureScreenshot());
      }
    }
  };
  // Discovery is captured before the detail is opened, so each screenshot shows its own surface.
  await captureState("discovery-lagos-30");

  await tab.clickButton("View apartment");
  await tab.waitForSelector("#active-workspace .unit-detail-root", 15_000);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const galleryPhotos = await tab.evaluate<{ total: number; loaded: number }>("(() => { const imgs = [...document.querySelectorAll('#active-workspace .unit-detail-root img')].filter((img) => img.src.includes('/demo/photos/')); return { total: imgs.length, loaded: imgs.filter((img) => img.complete && img.naturalWidth > 0).length }; })()");
  assert.ok(galleryPhotos.total >= 4 && galleryPhotos.total <= 5, `unit-detail gallery shows 4 to 5 photos, found ${galleryPhotos.total}`);
  assert.equal(galleryPhotos.loaded, galleryPhotos.total, "every gallery photo loads");
  await captureState("unit-detail-gallery");
  await stopIntercept();
  writeFileSync(join(output, "findings.txt"), findings.length === 0 ? "No horizontal overflow or controls below 44px.\n" : `${findings.join("\n")}\n`);
  console.log(`Captured 2 demo surfaces at 320/390/768/1280 in light and dark. Findings: ${findings.length}.`);
  console.log(`Lagos cards: ${cardCount}; card photos loaded: ${cardPhotos}; gallery photos: ${galleryPhotos.total} (loaded ${galleryPhotos.loaded}).`);
} finally {
  await browser.close();
  await fixture.close();
}
