import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GUEST_MODE_CHOOSER,
  GUEST_MODES,
  guestModeSwitchAnnouncement,
  type ModePresentation,
} from "../apps/web-agent/src/guest-content.js";
import {
  composerHtml,
  demoListingChipHtml,
  domainTagHtml,
  personaRowHtml,
  switchDividerHtml,
} from "../apps/local-guest/src/guest-kit.js";
import { launchRealBrowser } from "./helpers/chrome-devtools.js";
import { startLocalGuestServer } from "../apps/local-guest/src/guest-server.js";
import { ScriptedAssistantModel } from "../apps/local-guest/src/assistant/scripted-assistant-model.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";

/*
 * Round-12 slice 2b-05 (pinned design/round-12/bundle.css): chat message & persona (kit defect #2: the human persona
 * mark is 24px with 12px initials), criteria chips, composer, concierge chooser, domain tag and switch divider, ported
 * as shell/platform chrome (ADR 0106, ADR 0107) with zero A2UI catalogue changes (ADR 0073, ADR 0102, issue 02 note).
 */

const FOUNDATIONS_CSS = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
const GUEST_KIT_TS = readFileSync(new URL("../apps/local-guest/src/guest-kit.ts", import.meta.url), "utf8");
const CLIENT_TS = readFileSync(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");
const SHORTLET_CATALOGS_TS = readFileSync(new URL("../apps/web-agent/src/shortlet-catalogs.ts", import.meta.url), "utf8");

const STAYS = GUEST_MODES.stays satisfies ModePresentation;

/** A second registered pack, so the chooser and the switch divider have two modes to work with (test-only, ADR 0108). */
async function startTwoModeServer() {
  const server = startLocalGuestServer({
    conciergeMode: "assistant-offline",
    modelClient: new ScriptedAssistantModel([]),
    additionalPacks: [createFakeShopPack()],
    port: 0,
  });
  const base = `http://127.0.0.1:${await server.listen()}`;
  return { server, base, close: () => server.close() };
}

test("2b-05 AC1: the persona row helper renders the pinned persona classes, escapes its values and fixes the human mark size", () => {
  const assistant = personaRowHtml({ mode: STAYS });
  assert.match(assistant, /class="ui-persona"/);
  assert.match(assistant, /class="ui-persona__mark"/);
  assert.match(assistant, /class="ui-persona__mode"/);
  // The persona wording is the shipped conciergeLabel copy, split into the plain name and the accented mode part.
  assert.match(assistant, new RegExp(`>\\s*${GUEST_MODE_CHOOSER.conciergeLabel(STAYS.label).split(" · ")[0]}\\s*<`));
  assert.match(assistant, new RegExp(`class="ui-persona__mode">\\s*· ${STAYS.label}\\s*<`));

  const human = personaRowHtml({ mode: STAYS, human: { initials: "OP" } });
  assert.match(human, /class="ui-persona ui-persona--human"/);
  assert.match(human, /class="ui-persona__mark"[^>]*>OP</, "the human mark carries the caller's initials");
  assert.doesNotMatch(human, /Tolu|Xenia/, "no human name copy is invented (D14)");

  const hostile = personaRowHtml({ mode: { ...STAYS, label: 'Stays <script>' }, human: { initials: "<b>" } });
  assert.doesNotMatch(hostile, /<script>|<b>/, "every value is escaped (ADR 0075)");

  // Kit defect #2 (ChatMessage README): the human mark is a 24px square with 12px 700 initials (12px is the floor).
  assert.match(
    FOUNDATIONS_CSS,
    /\.ui-persona--human \.ui-persona__mark\s*\{[^}]*inline-size:\s*1\.5rem[^}]*font:\s*700 0\.75rem\/1 var\(--font-sans\)/,
    "the human persona mark renders 24x24 with >=12px initials",
  );
});

test("2b-05 AC1 & I4: the switch divider and domain tag helpers use only shipped copy and kit icons", () => {
  const divider = switchDividerHtml(STAYS);
  assert.match(divider, /class="ui-switch-divider"/);
  assert.match(divider, /class="ui-switch-divider__text"/);
  assert.match(divider, /class="ui-agent-mark"/);
  assert.ok(
    divider.includes(guestModeSwitchAnnouncement(GUEST_MODE_CHOOSER.conciergeLabel(STAYS.label))),
    "the divider text is the shipped switch announcement, never new copy",
  );

  const tag = domainTagHtml({ label: "Stays", icon: STAYS.persona.icon });
  assert.match(tag, /class="ui-domain-tag"/);
  assert.match(tag, /class="ui-agent-mark"/);
  assert.ok(tag.includes("Stays"));
  assert.doesNotMatch(tag, /<script>/, "the domain tag escapes its label");

  assert.match(FOUNDATIONS_CSS, /\.ui-domain-tag\s*\{[^}]*font: 400 var\(--font-size-small\)\/var\(--font-line-small\) var\(--font-sans\)/);
  assert.match(FOUNDATIONS_CSS, /\.ui-domain-tag \.ui-agent-mark\s*\{[^}]*inline-size:\s*1\.125rem[^}]*block-size:\s*1\.125rem/);
  assert.match(FOUNDATIONS_CSS, /\.ui-switch-divider \.ui-agent-mark\s*\{[^}]*inline-size:\s*1\.25rem[^}]*block-size:\s*1\.25rem/);
});

test("2b-05 AC3 & I3: the composer keeps one copy source for chat and panel, and the pinned 2b-05 classes exist per class-map", () => {
  const chat = composerHtml(STAYS, "chat");
  const page = composerHtml(STAYS, "page");
  for (const variant of [chat, page]) {
    assert.match(variant, /id="composer-input"/);
    assert.match(variant, /id="composer-submit"/);
    assert.ok(variant.includes(STAYS.composer.label), "the label comes from the mode (ADR 0107)");
    assert.ok(variant.includes(STAYS.composer.ariaLabel), "the aria-label comes from the mode");
  }
  // The chat shell's pill shows the placeholder; the panel form shows its label and hint instead (no copy change).
  assert.ok(chat.includes(STAYS.composer.placeholder), "the placeholder comes from the mode");
  assert.match(chat, /ui-composer/);
  assert.match(page, /ui-composer/);
  assert.match(chat, /ui-composer__input/);
  assert.match(chat, /ui-composer__send/);
  assert.match(page, /ui-composer__send/);

  // class-map.md 2b-05 group: every mapped class exists in the foundations stylesheet.
  for (const cls of [
    ".ui-conversation", ".ui-persona", ".ui-persona__mark", ".ui-persona__mode", ".ui-persona--human",
    ".ui-message", ".ui-message--guest", ".ui-chips", ".ui-chip", ".ui-chip--add", ".ui-chip--demo",
    ".ui-composer", ".ui-composer__input", ".ui-composer__send", ".ui-chooser", ".ui-chooser--dialog",
    ".ui-chooser__options", ".ui-chooser__option", ".ui-chooser__text", ".ui-chooser__line",
    ".ui-domain-tag", ".ui-switch-divider", ".ui-switch-divider__text",
  ]) {
    assert.ok(FOUNDATIONS_CSS.includes(cls), `missing 2b-05 class ${cls}`);
  }
  // The pinned chip: a 44px pill with an inset ring, mode tint only on the selected chip (CriteriaChip README).
  assert.match(FOUNDATIONS_CSS, /\.ui-chip\s*\{[^}]*min-block-size:\s*var\(--control-min-target\)/s);
  assert.match(FOUNDATIONS_CSS, /\.ui-chip\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/s);
  assert.match(FOUNDATIONS_CSS, /\.ui-chip\[aria-pressed="true"\], \.ui-chip:has\(input:checked\)\s*\{[^}]*var\(--mode-accent-subtle,\s*var\(--color-action-subtle\)\)/s);
  assert.match(FOUNDATIONS_CSS, /\.ui-chip--demo\s*\{[^}]*min-block-size:\s*1\.5rem[^}]*cursor:\s*default/s);

  // AC3 / issue 02 note: zero A2UI schema or catalogue changes. These components never enter the typed catalogues.
  assert.doesNotMatch(SHORTLET_CATALOGS_TS, /ui-(chooser|persona|composer|chips|message|switch-divider|domain-tag)|ChatCard/, "no 2b-05 class or ChatCard enters shortlet-catalogs.ts");
  assert.ok(demoListingChipHtml().includes("ui-chip--demo"), "the demo chip keeps its kit helper");
});

test("2b-05 AC3 & I6: the client renders the chooser strip, sheet and switch divider through the kit contract", () => {
  assert.match(CLIENT_TS, /switchDividerHtml/, "the client imports the kit's switch divider helper");
  assert.match(CLIENT_TS, /ui-chooser__option mode-choice/, "a chooser option keeps its code hook and gains the pinned class");
  assert.match(CLIENT_TS, /ui-chooser__options/, "the strip and sheet wrap their options in the pinned options grid");
  assert.match(CLIENT_TS, /ui-chooser--dialog/, "the sheet is the pinned dialog chooser");
  assert.match(CLIENT_TS, /ui-composer__send|ui-message--guest/, "the client carries the pinned composer/message hooks");
  assert.match(FOUNDATIONS_CSS, /\.ui-conversation\s*\{/, "the conversation column contract lives in the foundations stylesheet");
});

test("2b-05 I4: no unapproved New/Brand copy lands in the kit or the client", () => {
  for (const source of [GUEST_KIT_TS, CLIENT_TS]) {
    assert.doesNotMatch(source, /Tolu from the/, "no human persona name is invented (D14)");
  }
});

test("2b-05 AC2 (real Chrome): chooser options, composer controls and criteria chips meet 44px targets with focus-visible rules at 320 and 1280", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(320, 640);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector(".mode-choice input[value='shop']", 10_000);

    const measured = await tab.evaluate<{
      strip: { name: string; width: number; height: number }[];
      optionsWrapper: boolean;
      text: boolean;
      line: boolean;
      sendH: number;
      inputH: number;
      chipH: number;
      overflow: boolean;
    }>(`(() => {
      const wrap = document.createElement('div');
      wrap.className = 'ui-page';
      wrap.dataset.mode = 'stays';
      wrap.innerHTML = ${JSON.stringify(
        `<div class="ui-chips"><button class="ui-chip criteria-chip" type="button">Lagos</button><button class="ui-chip criteria-chip ui-chip--add" type="button">Add budget</button>${demoListingChipHtml()}</div>`,
      )};
      document.body.append(wrap);
      const res = {
        strip: Array.from(document.querySelectorAll('.mode-choice, .mode-mark')).map((el) => {
          const box = el.getBoundingClientRect();
          return { name: el.className, width: box.width, height: box.height };
        }),
        optionsWrapper: document.querySelector('.mode-choices.ui-chooser .ui-chooser__options') !== null,
        text: document.querySelector('.mode-choice .ui-chooser__text') !== null,
        line: document.querySelector('.mode-choice .ui-chooser__line') !== null,
        sendH: document.querySelector('#composer-submit').getBoundingClientRect().height,
        inputH: document.querySelector('#composer-input').getBoundingClientRect().height,
        chipH: wrap.querySelector('.criteria-chip').getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
      wrap.remove();
      return res;
    })()`);
    assert.ok(measured.optionsWrapper, "the strip is the pinned chooser with an options grid");
    assert.ok(measured.text && measured.line, "each option carries the pinned text and line columns");
    assert.ok(measured.strip.length >= 3, "the mark and both choices are measured");
    for (const control of measured.strip) {
      assert.ok(control.width >= 44 && control.height >= 44, `${control.name} is at least 44 by 44 (got ${control.width} by ${control.height})`);
    }
    assert.ok(measured.sendH >= 44, `the composer send button is >=44 (${measured.sendH})`);
    assert.ok(measured.inputH >= 44, `the composer input is >=44 (${measured.inputH})`);
    assert.ok(measured.chipH >= 44, `a criteria chip is >=44 (${measured.chipH})`);
    assert.equal(measured.overflow, false, "no horizontal overflow at 320px");

    const look = await tab.evaluate<{ checked: string; unchecked: string }>(`(() => {
      const at = (domain) => getComputedStyle(document.querySelector('.mode-choice[data-domain="' + domain + '"]')).backgroundColor;
      return { checked: at('shortlet'), unchecked: at('shop') };
    })()`);
    assert.notEqual(look.checked, look.unchecked, "the checked choice looks different from an unchecked one");

    const focus = await tab.evaluate<{ visible: boolean; outline: string }>(`(() => {
      const input = document.querySelector('.mode-choice input[value="shop"]');
      input.focus();
      return { visible: input.matches(':focus-visible'), outline: getComputedStyle(document.querySelector('.mode-choice[data-domain="shop"]')).outlineStyle };
    })()`);
    assert.ok(focus.visible, "the radio matches :focus-visible");
    assert.notEqual(focus.outline, "none", "the focused option draws an outline");

    // The sheet is the pinned dialog chooser; its rows stay >=44 at 320px.
    await tab.evaluate("document.querySelector('.mode-mark').click()");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open === true", 5_000);
    const sheet = await tab.evaluate<{ dialog: boolean; rowH: number; closeH: number }>(`(() => {
      const rows = Array.from(document.querySelectorAll('.mode-sheet .mode-choice')).map((el) => el.getBoundingClientRect().height);
      return {
        dialog: document.querySelector('dialog.mode-sheet').classList.contains('ui-dialog'),
        rowH: Math.min(...rows),
        closeH: document.querySelector('.mode-sheet__close').getBoundingClientRect().height,
      };
    })()`);
    assert.ok(sheet.dialog, "the sheet dialog carries the pinned ui-dialog class");
    assert.ok(sheet.rowH >= 44, `each dialog row is >=44 (${sheet.rowH})`);
    assert.ok(sheet.closeH >= 44, `Close is >=44 (${sheet.closeH})`);
    await tab.pressKey("Escape");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open !== true", 5_000);

    // 1280px, light and dark: the same targets hold, and the human persona mark measures 24x24 with >=12px initials.
    await tab.setViewport(1280, 900);
    for (const theme of ["light", "dark"] as const) {
      const m = await tab.evaluate<{ mark: { w: number; h: number; font: number }; sendH: number; stripH: number; overflow: boolean }>(`(() => {
        document.documentElement.dataset.theme = ${JSON.stringify(theme)};
        const wrap = document.createElement('div');
        wrap.className = 'ui-page';
        wrap.dataset.mode = 'stays';
        wrap.innerHTML = ${JSON.stringify(personaRowHtml({ mode: STAYS, human: { initials: "OP" } }))};
        document.body.append(wrap);
        const mark = wrap.querySelector('.ui-persona__mark');
        const styles = getComputedStyle(mark);
        const box = mark.getBoundingClientRect();
        const res = {
          mark: { w: box.width, h: box.height, font: Number.parseFloat(styles.fontSize) },
          sendH: document.querySelector('#composer-submit').getBoundingClientRect().height,
          stripH: document.querySelector('.mode-choice').getBoundingClientRect().height,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
        wrap.remove();
        return res;
      })()`);
      assert.ok(m.mark.w === 24 && m.mark.h === 24, `${theme} human persona mark is 24x24 (got ${m.mark.w}x${m.mark.h})`);
      assert.ok(m.mark.font >= 12, `${theme} human persona initials are >=12px (got ${m.mark.font})`);
      assert.ok(m.sendH >= 44, `${theme} composer send >=44 (${m.sendH})`);
      assert.ok(m.stripH >= 44, `${theme} chooser option >=44 (${m.stripH})`);
      assert.equal(m.overflow, false, `${theme} no horizontal overflow at 1280px`);
    }
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test("2b-05 AC4 & I6 (real Chrome): a committed switch leaves one switch divider row with the shipped announcement copy", async () => {
  const fixture = await startTwoModeServer();
  const browser = await launchRealBrowser();
  try {
    const tab = await browser.createTab();
    await tab.setViewport(1280, 900);
    await tab.navigate(`${fixture.base}/`);
    await tab.waitForSelector(".mode-mark", 10_000);
    await tab.evaluate("document.querySelector('.mode-mark').click()");
    await tab.waitForFunction("document.querySelector('dialog.mode-sheet')?.open === true", 5_000);
    await tab.evaluate("document.querySelector('dialog.mode-sheet .mode-choice input[value=\"shop\"]').click()");
    await tab.waitForFunction("document.documentElement.dataset.mode === 'shop'", 10_000);

    const divider = await tab.evaluate<{ count: number; text: string; mark: boolean; inTranscript: boolean }>(`(() => {
      const rows = Array.from(document.querySelectorAll('#transcript .ui-switch-divider'));
      return {
        count: rows.length,
        text: rows[0]?.textContent?.trim() ?? '',
        mark: rows[0]?.querySelector('.ui-agent-mark') !== null,
        inTranscript: rows[0]?.closest('[aria-live]') !== null,
    };
    })()`);
    const expected = guestModeSwitchAnnouncement(GUEST_MODE_CHOOSER.conciergeLabel("Shop"));
    assert.equal(divider.count, 1, "exactly one divider row is left by the switch");
    assert.equal(divider.text, expected, `the divider reads the shipped announcement copy (${expected})`);
    assert.ok(divider.mark, "the divider shows the new mode's agent mark");
    assert.ok(divider.inTranscript, "the divider sits inside the conversation log (ADR 0107 decision 11)");
    await tab.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
});
