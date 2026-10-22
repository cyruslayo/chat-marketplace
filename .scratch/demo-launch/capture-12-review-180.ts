import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { restartFixture, guestActionOrUndefined } from "../../test/helpers/guest-restart.js";
import { launchRealBrowser } from "../../test/helpers/chrome-devtools.js";
import { extendUnit } from "../../test/helpers/demo-extended-journey.js";

// Demo-launch issue 12 (AC2 and AC3 capture): a synthetic 180-night request draft and review, driven through the
// fixture API (as drive-13.ts does), then shown in the real browser in light and dark at 320/390/768/1280.
// Local test data only, stubbed provider. One browser process at a time.
const output = ".scratch/demo-launch/screenshots/12";
mkdirSync(output, { recursive: true });
const fixture = await restartFixture({ demo: true, deployment: "staging" });
const unit = fixture.environment.unitRepository.findAll()[0]!;
fixture.environment.unitRepository.save(extendUnit(unit, { claimsThrough: "2028-06-30" }));

const EVENTS = ["shortlet.discovery.view-unit", "shortlet.unit-detail.request-to-book", "shortlet.request-draft.review"] as const;
let r: any = await fixture.send("/api/turn", { text: "I need an apartment in Ikoyi for two people." });
r = await fixture.send("/api/turn", { text: "10 Sep 2026 to 9 Mar 2027" });
r = await fixture.send("/api/turn", { text: "2 guests" });
let reachedDraft = false;
for (let step = 0; step < 12 && !reachedDraft; step++) {
  const surface = r.surfaces?.[0];
  assert.ok(surface, `step ${step}: a surface is expected`);
  const name = EVENTS.find((event) => guestActionOrUndefined(surface, event) !== undefined);
  assert.ok(name, `step ${step}: no known action on ${surface.surfaceId}`);
  if (name === "shortlet.request-draft.review") { reachedDraft = true; break; }
  const action = guestActionOrUndefined(surface, name)!;
  r = await fixture.send("/api/event", action);
  assert.equal(r.ok, true, `event ${name} accepted`);
}
assert.ok(reachedDraft, "the request draft was reached");
const draftSurface = r.surfaces[0];
console.log("draft surface", draftSurface.surfaceId);

const findings: string[] = [];
const smallTargets = `[...document.querySelectorAll('a, button, input, select, textarea, summary')].filter((el) => { if (el.type === 'hidden' || el.type === 'file' || el.closest('[hidden]') || el.classList.contains('skip-link')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44); }).map((el) => el.tagName + ':' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40))`;
async function shoot(tab: any, label: string): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [320, 390, 768, 1280]) {
      await tab.setViewport(width, 900);
      await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const height = await tab.evaluate<number>("document.documentElement.scrollHeight");
      await tab.setViewport(width, Math.min(4_000, Math.max(800, height)));
      const audit = await tab.evaluate<{ overflow: number; small: string[] }>(`({ overflow: document.documentElement.scrollWidth - innerWidth, small: ${smallTargets} })`);
      const name = `${label}-${theme}-${width}`;
      if (audit.overflow > 0) findings.push(`${name}: horizontal overflow ${audit.overflow}px`);
      if (audit.small.length > 0) findings.push(`${name}: controls below 44px (${audit.small.length}) ${audit.small.slice(0, 3).join(" | ")}`);
      writeFileSync(`${output}/${name}.png`, await tab.captureScreenshot());
    }
  }
}
const browser = await launchRealBrowser();
const routePath = String(draftSurface.conventionalRoute);
try {
  const tab = await browser.createTab();
  await tab.setExtraHeaders({ cookie: fixture.cookie });
  await tab.setViewport(1280, 900);
  // Draft: the standalone request page (ADR 0077: the same content the chat workspace renders).
  await tab.navigate(`${fixture.base}${routePath}`);
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const draftText = await tab.evaluate<string>("document.body.innerText");
  assert.ok(draftText.includes("Payment schedule"), "the draft shows the Billing Period schedule");
  assert.ok(draftText.includes("first Billing Period only"), "the draft labels the amount due as the first Billing Period");
  await shoot(tab, "180-night-request-draft");
  // Review: the review action, then the same page.
  const review = guestActionOrUndefined(draftSurface, "shortlet.request-draft.review");
  assert.ok(review, "the review action is on the draft");
  const reviewed: any = await fixture.send("/api/event", review);
  assert.equal(reviewed.ok, true, "review accepted");
  await tab.navigate(`${fixture.base}${routePath}`);
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const reviewText = await tab.evaluate<string>("document.body.innerText");
  assert.ok(reviewText.includes("Payment schedule"), "the review shows the Billing Period schedule");
  assert.ok(reviewText.includes("Total to complete booking"), "the review shows the amount due now");
  assert.ok(reviewText.includes("All-In Stay Total"), "the review shows the whole-stay total");
  await shoot(tab, "180-night-request-review");
  writeFileSync(`${output}/findings-180.txt`, findings.length === 0 ? "No horizontal overflow or controls below 44px.\n" : `${findings.join("\n")}\n`);
  console.log(`180-night capture done. Findings: ${findings.length}`);
} finally {
  await browser.close();
  await fixture.close();
}
