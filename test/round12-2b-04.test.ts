import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resultRowHtml, stayCardHtml, type StayPreview } from "../apps/local-guest/src/guest-kit.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { restartFixture } from "./helpers/guest-restart.js";

const FOUNDATIONS_CSS = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
const GUEST_KIT_TS = readFileSync(new URL("../apps/local-guest/src/guest-kit.ts", import.meta.url), "utf8");
const SHORTLET_RENDERERS_TS = readFileSync(new URL("../apps/local-guest/src/shortlet-renderers.ts", import.meta.url), "utf8");

const SAMPLE_PREVIEW: StayPreview = {
  href: "/stays/unit-1",
  title: "Bright 2-Bedroom Flat in Old Ikoyi",
  neighbourhood: "Old Ikoyi",
  city: "Lagos",
  bedrooms: 2,
  bathrooms: 2,
  capacity: 4,
  allInStayTotalKobo: 370_000_00,
  nightlyKobo: 120_000_00,
  refundableSecurityDepositKobo: 0,
  nights: 3,
  photoSrc: "/photos/unit-1.jpg",
  photoCount: 7,
  unitId: "unit-1",
  demoListing: true,
};

test("2b-04 AC1 & AC3: Stay card markup uses __body and __label, keeps .stay-card/.stay-grid hooks and '1 / N' copy, and no Save/View routes", () => {
  const card = stayCardHtml(SAMPLE_PREVIEW);
  assert.match(card, /class="ui-stay-card__body"/);
  assert.match(card, /class="ui-stay-card__label"/);
  assert.match(card, /1 \/ 7/);
  assert.match(card, /Demo listing/);
  assert.doesNotMatch(card, /Save\b|Saved\b|Photo 1 of 7/);

  assert.match(SHORTLET_RENDERERS_TS, /stay-card ui-stay-card/);
  assert.match(SHORTLET_RENDERERS_TS, /stay-grid/);
  assert.doesNotMatch(GUEST_KIT_TS, /\.stay-result\b/);
  assert.match(FOUNDATIONS_CSS, /\.ui-stay-card__title\s*\{[^}]*min-block-size:\s*var\(--control-min-target\)/);
});

test("2b-04 AC2: .ui-stay-card__title, .ui-result-row, .ui-list__row, and .ui-segmented options measure >=44px at 320px with zero clipping or overflow", async () => {
  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab(`${fixture.base}/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`);
    try {
      await tab.waitForFunction("document.readyState === 'complete' && document.styleSheets.length > 0", 5_000);
      await tab.setCssViewport(320, 640);
      const markup = [
        stayCardHtml({ ...SAMPLE_PREVIEW, title: "Flat" }),
        `<div class="ui-result-rows">${resultRowHtml(SAMPLE_PREVIEW)}<a class="ui-result-row ui-result-row--muted ui-result-row--no-thumb" href="#r2"><span class="ui-result-row__body"><span class="ui-result-row__title">Closed stay</span></span></a></div>`,
        `<div class="ui-segmented"><a href="#concierge" aria-current="true">Concierge</a><a href="#list">List</a></div>`,
        `<ul class="ui-list"><li><a class="ui-list__row" href="#item"><span class="ui-list__primary">Old Ikoyi Loft</span><span class="ui-list__aside ui-list__aside--money">₦370,000</span><span class="ui-list__secondary">10–13 Sept 2026</span></a></li><li class="ui-list__row ui-list__row--static"><span class="ui-list__primary">Static row</span></li></ul>`,
      ].join("");

      for (const theme of ["light", "dark"] as const) {
        await tab.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        const m = await tab.evaluate<{
          titleH: number;
          rowH: number;
          listRowH: number;
          segLinkH: number;
          asideFont: string;
          overflow: boolean;
        }>(`(() => {
          const wrap = document.createElement('div');
          wrap.className = 'ui-page';
          wrap.setAttribute('data-mode', 'stays');
          wrap.innerHTML = ${JSON.stringify(markup)};
          document.body.append(wrap);
          const res = {
            titleH: wrap.querySelector('.ui-stay-card__title').getBoundingClientRect().height,
            rowH: wrap.querySelector('.ui-result-row').getBoundingClientRect().height,
            listRowH: wrap.querySelector('.ui-list__row').getBoundingClientRect().height,
            segLinkH: wrap.querySelector('.ui-segmented > a').getBoundingClientRect().height,
            asideFont: getComputedStyle(wrap.querySelector('.ui-list__aside--money')).fontFamily,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          };
          wrap.remove();
          return res;
        })()`);
        assert.ok(m.titleH >= 44, `${theme} .ui-stay-card__title >=44 (${m.titleH})`);
        assert.ok(m.rowH >= 44, `${theme} .ui-result-row >=44 (${m.rowH})`);
        assert.ok(m.listRowH >= 44, `${theme} .ui-list__row >=44 (${m.listRowH})`);
        assert.ok(m.segLinkH >= 44, `${theme} .ui-segmented > a >=44 (${m.segLinkH})`);
        assert.match(m.asideFont, /Newsreader/, `${theme} money aside uses Newsreader`);
        assert.equal(m.overflow, false, `${theme} 320px zero overflow`);
      }
    } finally {
      await tab.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
});
