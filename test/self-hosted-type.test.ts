import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { LANDING_BINARY_ASSETS } from "../apps/local-guest/src/landing-assets.js";
import { renderGuestShellHtml } from "../apps/local-guest/src/guest-server.js";
import { renderLandingHtml } from "../apps/local-guest/src/landing-page-html.js";
import { operatorGet, startSignedInOperator } from "./helpers/operator-session.js";
import { restartFixture } from "./helpers/guest-restart.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";

const FOUNDATIONS_CSS = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
const LANDING_CSS = readFileSync(new URL("../apps/web/src/shortlet-landing.css", import.meta.url), "utf8");

test("AC1: No third-party font request on any page", async () => {
  for (const [label, css] of [["shortlet-foundations.css", FOUNDATIONS_CSS], ["shortlet-landing.css", LANDING_CSS]] as const) {
    assert.doesNotMatch(css, /@import\s+url\s*\(/i, `${label} has no @import url`);
    assert.doesNotMatch(css, /fonts\.googleapis\.com|fonts\.gstatic\.com|https?:\/\//i, `${label} has no third-party URLs`);
  }
  const guestShell = renderGuestShellHtml();
  const landing = renderLandingHtml();
  for (const [label, html] of [["guest shell", guestShell], ["landing", landing]] as const) {
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/i, `${label} has no Google Fonts`);
  }
  for (const match of FOUNDATIONS_CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const src = /src:\s*([^;]+);/.exec(match[1]!)?.[1] ?? "";
    if (/url\(/.test(src)) {
      assert.match(src, /url\("\/landing\/fonts\/[^"]+\.woff2"\)/, `self-hosted origin path only: ${src}`);
    }
  }
  assert.ok((FOUNDATIONS_CSS.match(/@font-face\s*\{/g) ?? []).length >= 3, "shortlet-foundations.css declares self-hosted @font-face rules");
});

test("AC2: Text is readable before fonts load via font-display: swap, size-adjusted fallbacks, and OFL notices", () => {
  const faces = [...FOUNDATIONS_CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
  const woff2Faces = faces.filter((body) => /format\("woff2"\)/.test(body));
  assert.equal(woff2Faces.length, 3, "three WOFF2 @font-face rules covering the 5 faces (Newsreader 500, 400i; Hanken Grotesk 400-700)");
  for (const body of woff2Faces) {
    assert.match(body, /font-display:\s*swap;/, "every WOFF2 face uses font-display: swap");
  }
  const fallbackFaces = faces.filter((body) => /Fallback/.test(body));
  assert.ok(fallbackFaces.length >= 2, "declares Newsreader Fallback and Hanken Grotesk Fallback");
  for (const body of fallbackFaces) {
    assert.match(body, /size-adjust:\s*\d+%/, "fallback face has size-adjust");
    assert.match(body, /ascent-override:/, "fallback face has ascent-override");
    assert.match(body, /descent-override:/, "fallback face has descent-override");
  }
  assert.match(FOUNDATIONS_CSS, /--font-sans:\s*"Hanken Grotesk",\s*"Hanken Grotesk Fallback",\s*system-ui,\s*-apple-system,\s*BlinkMacSystemFont,\s*"Segoe UI",\s*sans-serif;/);
  assert.match(FOUNDATIONS_CSS, /--font-display:\s*"Newsreader",\s*"Newsreader Fallback",/);
  assert.ok(existsSync(new URL("../apps/local-guest/assets/fonts/OFL-Newsreader.txt", import.meta.url)));
  assert.ok(existsSync(new URL("../apps/local-guest/assets/fonts/OFL-HankenGrotesk.txt", import.meta.url)));
  assert.ok(existsSync(new URL("../apps/local-guest/assets/fonts/CREDITS.md", import.meta.url)));
});

test("AC3: Self-hosted WOFF2 font payload stays within the 160 KB kit budget", () => {
  const fontDir = new URL("../apps/local-guest/assets/fonts/", import.meta.url);
  const woff2Files = readdirSync(fontDir).filter((name) => name.endsWith(".woff2")).sort();
  assert.deepEqual(woff2Files, [
    "hanken-grotesk-400-700.woff2",
    "newsreader-500.woff2",
    "newsreader-italic-400.woff2",
  ]);
  const totalBytes = woff2Files.reduce((sum, name) => sum + statSync(new URL(name, fontDir)).size, 0);
  assert.ok(totalBytes <= 160 * 1024, `total WOFF2 payload ${totalBytes} <= ${160 * 1024}`);
});

test("AC4: Every ₦ money figure renders in Newsreader, and with fonts blocked renders in fallback with zero overflow or overlap", async () => {
  for (const selector of [
    ".ui-money-total",
    ".ui-facts dd.ui-money-total",
    ".ui-price-breakdown__value",
    ".ui-result-row__price",
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(FOUNDATIONS_CSS);
    assert.ok(match, `${selector} rule exists`);
    assert.match(match[1]!, /font[^;]*var\(--font-display\)/, `${selector} uses --font-display`);
  }

  const fixture = await restartFixture();
  const browser = await launchRealBrowser();
  try {
    const searchUrl = `${fixture.base}/stays/search?area=old-ikoyi&checkIn=2026-09-10&checkOut=2026-09-13&partySize=2`;
    // Normal load: verify Newsreader draws ₦ amounts and zero third-party font requests
    const tab = await browser.createTab();
    try {
      await tab.setViewport(360, 640);
      await tab.navigate(searchUrl);
      await tab.waitForSelector(".ui-money-total");
      await tab.evaluate("document.fonts.ready.then(() => true)");
      const fontFamily = await tab.evaluate<string>("getComputedStyle(document.querySelector('.ui-money-total')).fontFamily");
      assert.match(fontFamily, /Newsreader/);
      const platformFonts = await tab.getPlatformFonts(".ui-money-total");
      assert.ok(platformFonts.some((f) => /Newsreader/i.test(f.familyName)), `expected Newsreader platform font, got ${JSON.stringify(platformFonts)}`);
      const thirdPartyFonts = await tab.evaluate<string[]>(
        "performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.woff2') || r.initiatorType === 'font').map((r) => new URL(r.name).origin).filter((o) => o !== location.origin)",
      );
      assert.deepEqual(thirdPartyFonts, [], "no third-party font requests");
    } finally {
      await tab.close();
    }

    // Fonts blocked: verify fallback renders cleanly without overflow or overlap
    const blocked = await browser.createTab();
    try {
      await blocked.setViewport(320, 640);
      const stop = await blocked.interceptRequests(async (url) =>
        url.includes("/landing/fonts/") ? { status: 404, headers: [], body: new Uint8Array() } : undefined,
      );
      await blocked.navigate(searchUrl);
      await blocked.waitForSelector(".ui-money-total");
      const check = await blocked.evaluate<{ overflow: number; overlap: boolean }>(
        `(() => {
          const totals = [...document.querySelectorAll('.ui-money-total')];
          const metas = [...document.querySelectorAll('.ui-stay-card__total .ui-money-metadata')];
          let overlap = false;
          for (let i = 0; i < Math.min(totals.length, metas.length); i++) {
            const a = totals[i].getBoundingClientRect();
            const b = metas[i].getBoundingClientRect();
            if (a.bottom > b.top + 1) overlap = true;
          }
          return { overflow: document.documentElement.scrollWidth - innerWidth, overlap };
        })()`,
      );
      await stop();
      assert.ok(check.overflow <= 0, `no horizontal overflow with fonts blocked (${check.overflow})`);
      assert.equal(check.overlap, false, "money total and metadata do not overlap with fonts blocked");
    } finally {
      await blocked.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("AC5: LANDING_BINARY_ASSETS and Operator server serve self-hosted WOFF2 fonts with long immutable cache headers and reject unknown paths", async () => {
  assert.ok("/landing/fonts/newsreader-500.woff2" in LANDING_BINARY_ASSETS);
  assert.ok("/landing/fonts/newsreader-italic-400.woff2" in LANDING_BINARY_ASSETS);
  assert.ok("/landing/fonts/hanken-grotesk-400-700.woff2" in LANDING_BINARY_ASSETS);

  const op = await startSignedInOperator();
  try {
    for (const path of [
      "/landing/fonts/newsreader-500.woff2",
      "/landing/fonts/newsreader-italic-400.woff2",
      "/landing/fonts/hanken-grotesk-400-700.woff2",
    ]) {
      const res = await operatorGet(op.session, path, "");
      assert.equal(res.status, 200, `${path} returns 200 on operator server`);
      assert.equal(res.headers.get("content-type"), "font/woff2");
      assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.ok((await res.arrayBuffer()).byteLength > 0);
    }
    const missing = await operatorGet(op.session, "/landing/fonts/unknown.woff2", "");
    assert.equal(missing.status, 404);
  } finally {
    await op.close();
  }
});
