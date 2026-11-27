import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GUEST_PAYMENT_COPY } from "../apps/web-agent/src/guest-content.js";
import { chatCardHtml, chatCardText, offerScreenHtml } from "../apps/local-guest/src/guest-kit.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { withStagePage } from "./helpers/guest-stage-pages.js";

/*
 * Round-12 slice 2b-06 (pinned design/round-12/bundle.css): chat card, action bar (--sticky), disclosure confirm and
 * commit panels, ported as shell/kit chrome with zero A2UI catalogue changes (ADR 0073, 0102, 0108, issue 02 note).
 * The chatCardHtml helper is authored ADR-0108-ready: strict JSON-serialisable props, escaped values, no hardcoded
 * domain copy, and a complete plain-text fallback (ADR 0074, 0075, 0077).
 */

const FOUNDATIONS_CSS = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
const GUEST_KIT_TS = readFileSync(new URL("../apps/local-guest/src/guest-kit.ts", import.meta.url), "utf8");
const CLIENT_TS = readFileSync(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
const SHORTLET_RENDERERS_TS = readFileSync(new URL("../apps/local-guest/src/shortlet-renderers.ts", import.meta.url), "utf8");

const CARD_PROPS = {
  title: "Your stays",
  aside: "Needs your action first",
  rows: [
    { text: "Ikoyi apartment · Payment due 30 Nov", href: "/stays/one", aside: "Pay by 11:44 AM WAT" },
    { text: "Lekki studio · Confirmed" },
  ],
  body: ["Two stays are waiting on you."],
  action: { label: "Open all 2 in Your stays", href: "/plans" },
} as const;

test("2b-06 AC1 & I3: the pinned 2b-06 classes exist per class-map", () => {
  for (const cls of [
    ".ui-chat-card", ".ui-chat-card__head", ".ui-chat-card__title", ".ui-chat-card__aside",
    ".ui-chat-card__rows", ".ui-chat-card__row", ".ui-action-bar--sticky",
    ".ui-confirm", ".ui-confirm__body", ".ui-effect", ".ui-effect__title", ".ui-effect__body",
    ".ui-panel--commit", ".ui-panel__title",
  ]) {
    assert.ok(FOUNDATIONS_CSS.includes(cls), `missing 2b-06 class ${cls}`);
  }
});

test("2b-06 AC1: the chat card rows are 44px links, the confirm summary is 52px, and both draw focus rings", () => {
  assert.match(FOUNDATIONS_CSS, /\.ui-chat-card__row\s*\{[^}]*min-block-size:\s*var\(--control-min-target\)/s);
  assert.match(FOUNDATIONS_CSS, /\.ui-chat-card__row\s*\{[^}]*text-decoration:\s*none/s);
  assert.match(FOUNDATIONS_CSS, /\.ui-confirm > summary\s*\{[^}]*min-block-size:\s*3\.25rem/s);
  assert.match(FOUNDATIONS_CSS, /\.ui-chat-card__row:focus-visible\s*\{[^}]*outline/s);
  // The pinned confirm is quiet (DisclosureConfirm README): surface with a border-subtle inset ring, no danger colour.
  const confirmBlock = FOUNDATIONS_CSS.slice(
    FOUNDATIONS_CSS.indexOf(".ui-confirm {"),
    FOUNDATIONS_CSS.indexOf(".ui-confirm__body p") === -1
      ? FOUNDATIONS_CSS.indexOf(".ui-confirm__body {") + 200
      : FOUNDATIONS_CSS.indexOf(".ui-confirm__body p"),
  );
  assert.ok(confirmBlock.length > 0, "the confirm block exists");
  assert.doesNotMatch(confirmBlock, /--color-danger/, "the disclosure confirm carries no danger colour");
  assert.match(FOUNDATIONS_CSS, /\.ui-confirm\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--color-border-subtle\)/s);
  assert.match(FOUNDATIONS_CSS, /\.ui-confirm\[open\] > summary \.ui-icon\s*\{[^}]*rotate\(180deg\)/s);
});

test("2b-06 AC2 & issue 02 note: chatCardHtml takes JSON-serialisable props, escapes every value and holds no domain copy", () => {
  const card = chatCardHtml(CARD_PROPS);
  assert.match(card, /class="ui-chat-card"/);
  assert.match(card, /class="ui-chat-card__head"/);
  assert.match(card, /class="ui-chat-card__title">Your stays</);
  assert.match(card, /class="ui-chat-card__aside">Needs your action first</);
  assert.match(card, /class="ui-chat-card__rows"/);
  assert.equal((card.match(/class="ui-chat-card__row"/g) ?? []).length, 2, "one row element per row prop");
  assert.match(card, /class="ui-chat-card__row" href="\/stays\/one"/, "a row with an href is a link");
  assert.match(card, /<b>Ikoyi apartment · Payment due 30 Nov<\/b>/);
  assert.match(card, /class="ui-chat-card__action"/);
  assert.match(card, /href="\/plans"/);

  // ADR 0108 decision 1: the props are plain JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(CARD_PROPS)), CARD_PROPS);

  // ADR 0075: every caller value is escaped; ADR 0077: the helper holds no copy of its own.
  const hostile = chatCardHtml({
    title: 'Stays <script>',
    aside: "<b>",
    rows: [{ text: "<img>", href: '"><script>' }],
    action: { label: "<i>", href: '"><script>' },
  });
  assert.doesNotMatch(hostile, /<script|<img|<i[ >]|onclick/i, "no unescaped value can become markup");
  assert.ok(hostile.includes("&lt;script&gt;"), "the hostile title is escaped");
  assert.ok(hostile.includes("&quot;&gt;&lt;script&gt;"), "the hostile href is escaped inside the attribute");
  for (const source of [GUEST_KIT_TS.slice(GUEST_KIT_TS.indexOf("chatCardHtml"), GUEST_KIT_TS.indexOf("chatCardText"))]) {
    assert.doesNotMatch(source, /Your stays|Payment schedule|Open all/, "the helper holds no domain copy (ADR 0077)");
  }
  // One action at most (ChatCard README rule).
  assert.equal((card.match(/class="ui-chat-card__action"/g) ?? []).length, 1);
});

test("2b-06 AC3 & ADR 0074: chatCardText is a complete plain-text fallback of the same props", () => {
  const text = chatCardText(CARD_PROPS);
  assert.ok(text.includes("Your stays"), "the title survives");
  assert.ok(text.includes("Needs your action first"), "the aside survives");
  assert.ok(text.includes("Ikoyi apartment · Payment due 30 Nov"), "each row's name survives");
  assert.ok(text.includes("Pay by 11:44 AM WAT"), "each row's aside survives");
  assert.ok(text.includes("/stays/one"), "each row's destination survives as text");
  assert.ok(text.includes("Two stays are waiting on you."), "the body survives");
  assert.ok(text.includes("Open all 2 in Your stays"), "the action's label survives");
  assert.ok(text.includes("/plans"), "the action's destination survives as text");
  assert.doesNotMatch(text, /class=/, "the fallback carries no markup hooks");
});

test("2b-06 AC1: the action bar is sticky only as --sticky, inline inside a 48rem container (ActionBar README)", () => {
  const base = FOUNDATIONS_CSS.slice(FOUNDATIONS_CSS.indexOf(".ui-action-bar {"), FOUNDATIONS_CSS.indexOf(".ui-action-bar > *"));
  assert.ok(base.length > 0, "the base action bar block exists");
  assert.doesNotMatch(base, /position:\s*sticky/, "the base action bar is not sticky");
  assert.match(FOUNDATIONS_CSS, /\.ui-action-bar--sticky\s*\{[^}]*position:\s*sticky/s);
  assert.match(
    FOUNDATIONS_CSS,
    /@container \(min-width: 48rem\)\s*\{[^}]*\.ui-action-bar\s*\{[^}]*border-radius:\s*var\(--radius-card\)[^}]*\}[^}]*\.ui-action-bar--sticky\s*\{[^}]*position:\s*static/s,
    "inside a 48rem container the bar is a bordered panel and --sticky sits inline",
  );
  // Every shipped bar that used to inherit stickiness from the base now carries the modifier.
  for (const [name, source, needle] of [
    ["offer bar", GUEST_KIT_TS, /ui-action-bar ui-action-bar--sticky offer-actions/] as const,
    ["payment bar", GUEST_KIT_TS, /payment-actions ui-action-bar ui-action-bar--sticky/] as const,
    ["request bar", GUEST_KIT_TS, /ui-action-bar ui-action-bar--sticky/] as const,
    ["unit action bar", SHORTLET_RENDERERS_TS, /ui-action-bar ui-action-bar--sticky unit-action-bar/] as const,
  ]) {
    assert.ok(source.match(needle) !== null, `${name} carries ui-action-bar--sticky`);
  }
});

test("2b-06 AC2 & I6: the four booking screens keep one shared markup source for chat and page", () => {
  // The organizers rebuild the Weaver tree from the same guest-kit helpers the standalone pages render (ADR 0080 parity).
  for (const helper of ["offerScreenHtml(", "paymentScreenHtml(", "requestScreenHtml(", "confirmationScreenHtml("]) {
    assert.ok(CLIENT_TS.includes(helper), `the client organizer rebuilds through ${helper}`);
    assert.ok(GUEST_KIT_TS.includes(`export function ${helper.slice(0, -1)}`), `${helper} is the kit's single source`);
  }
  assert.ok(offerScreenHtml.name === "offerScreenHtml");
  // The shipped payment copy is unchanged (kickoff I4: "Continue to secure payment" is not approved).
  assert.ok(GUEST_PAYMENT_COPY.accept.length > 0);
  for (const source of [GUEST_KIT_TS, CLIENT_TS]) {
    assert.doesNotMatch(source, /Continue to secure payment/, "the unapproved payment copy does not land");
  }
  assert.ok(GUEST_KIT_TS.includes("Continue to stay payment"), "the shipped payment copy stays");
});

test("2b-06 AC1 (real Chrome): chat card rows, confirm summary and action bar targets hold at 320 and 1280, light and dark", async () => {
  await withStagePage({ label: "Request review", stage: "review" }, async ({ fixture, path }) => {
    const browser = await launchRealBrowser();
    try {
      const tab = await browser.createTab();
      const [cookieName, ...cookieValue] = fixture.cookie.split("=");
      await tab.setCookie(cookieName!, cookieValue.join("="), fixture.base);
      for (const [label, width] of [["320", 320], ["1280", 1280]] as const) {
        await tab.setViewport(width, width === 320 ? 640 : 900);
        await tab.navigate(`${fixture.base}${path}`);
        await tab.waitForSelector(".request-actions.ui-action-bar", 10_000);
        for (const theme of ["light", "dark"] as const) {
          const measured = await tab.evaluate<{ rowH: number; summaryH: number; barButtonH: number; barPosition: string; overflow: boolean; focusOutline: string }>(`
            (() => {
              document.documentElement.dataset.theme = ${JSON.stringify(theme)};
              const wrap = document.createElement("div");
              wrap.className = "ui-page";
              wrap.innerHTML = ${JSON.stringify(
                chatCardHtml(CARD_PROPS) +
                  '<details class="ui-confirm"><summary>Decline this transfer…</summary><div class="ui-confirm__body"><p>Choose a reason before declining. Nothing was changed.</p><div class="ui-effect"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg><p class="ui-effect__title">What this changes</p><p class="ui-effect__body">Makes the Reservation and tells the Guest it is declined.</p></div></div></details>',
              )};
              document.body.append(wrap);
              const row = wrap.querySelector(".ui-chat-card__row");
              const summary = wrap.querySelector(".ui-confirm > summary");
              const barButton = document.querySelector(".request-actions.ui-action-bar .ui-button");
              const focusRow = wrap.querySelector("a.ui-chat-card__row");
              const before = focusRow.focusVisible ?? 0;
              focusRow.focus();
              const res = {
                rowH: row.getBoundingClientRect().height,
                summaryH: summary.getBoundingClientRect().height,
                barButtonH: barButton.getBoundingClientRect().height,
                barPosition: getComputedStyle(document.querySelector(".request-actions.ui-action-bar")).position,
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                focusOutline: getComputedStyle(focusRow).outlineStyle,
              };
              void before;
              wrap.remove();
              return res;
            })()`);
          assert.ok(measured.rowH >= 44, `${label} ${theme} chat card row >=44 (${measured.rowH})`);
          assert.ok(measured.summaryH >= 44, `${label} ${theme} confirm summary >=44 (${measured.summaryH})`);
          assert.ok(measured.barButtonH >= 44, `${label} ${theme} action bar button >=44 (${measured.barButtonH})`);
          assert.equal(measured.barPosition, "sticky", `${label} ${theme} the request bar keeps its sticky position on the page`);
          assert.equal(measured.overflow, false, `${label} ${theme} no horizontal overflow`);
          assert.notEqual(measured.focusOutline, "none", `${label} ${theme} a focused card row draws an outline`);
        }
      }

      // Inside a 48rem container the pinned query sits the bar inline (ActionBar README: inline panel from 768px).
      const inline = await tab.evaluate<{ position: string; radius: string }>(`
        (() => {
          const host = document.createElement("div");
          host.style.containerType = "inline-size";
          host.style.inlineSize = "60rem";
          host.innerHTML = '<div class="ui-action-bar ui-action-bar--sticky"><span class="ui-button">Request to book</span></div>';
          document.body.append(host);
          const bar = host.firstElementChild;
          const res = { position: getComputedStyle(bar).position, radius: getComputedStyle(bar).borderRadius };
          host.remove();
          return res;
        })()`);
      assert.equal(inline.position, "static", "inside a 48rem container the sticky bar sits inline");
      assert.notEqual(inline.radius, "0px", "inside a 48rem container the bar is a rounded panel");
      await tab.close();
    } finally {
      await browser.close();
    }
  });
});
