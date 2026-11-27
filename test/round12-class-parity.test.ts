import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const FOUNDATIONS_CSS = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
const CLASS_MAP_MD = readFileSync(new URL("../.scratch/app-expansion/design/round-12/class-map.md", import.meta.url), "utf8");

function walkTsCssHtml(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "public" || entry === ".cloudflare" || entry === ".wrangler") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) files.push(...walkTsCssHtml(full));
    else if (/\.(ts|tsx|css|html)$/.test(entry)) files.push(full);
  }
  return files;
}

const BOARD_ONLY_SECTION = CLASS_MAP_MD.split("## 2. Board-only classes")[1]?.split("## 3. Existing code-only classes")[0] ?? "";
const BOARD_ONLY_CLASSES = [
  ...new Set(
    [...BOARD_ONLY_SECTION.matchAll(/`(bd(?:-[\w-]+)?|xk-[\w-]+)`/g)].map((m) => m[1]!),
  ),
].sort();

const GROUP_2B_01_CLASSES = [
  ".ui-visually-hidden",
  ".ui-button",
  ".ui-button--primary",
  ".ui-button--secondary",
  ".ui-button--quiet",
  ".ui-button--pill",
  ".ui-button--small",
  ".ui-button--block",
  ".ui-link",
  ".ui-field",
  ".ui-field__label",
  ".ui-field__optional",
  ".ui-field__hint",
  ".ui-field__input",
  ".ui-field__error",
  ".ui-choice",
  ".ui-legend",
  ".ui-banner",
  ".ui-banner__title",
  ".ui-banner__body",
  ".ui-banner__actions",
  ".ui-banner--neutral",
  ".ui-banner--info",
  ".ui-banner--success",
  ".ui-banner--warning",
  ".ui-banner--danger",
  ".ui-status",
  ".ui-status--success",
  ".ui-status--warning",
  ".ui-status--info",
  ".ui-status--danger",
  ".ui-status--muted",
  ".ui-tag",
  ".ui-tag--overdue",
  ".ui-deadline",
  ".ui-deadline__at",
  ".ui-deadline__left",
  ".ui-deadline--info",
  ".ui-deadline--overdue",
  ".ui-facts",
  ".ui-facts--stacked",
  ".ui-money-total",
  ".ui-empty",
  ".ui-empty__title",
  ".ui-empty__body",
  ".ui-skeleton",
  ".ui-skeleton--title",
  ".ui-skeleton--card",
  ".ui-skeleton--receipt",
] as const;

const PRESERVED_CODE_CLASSES = [
  ".ui-button--destructive",
  ".ui-sr-only",
  ".ui-eyebrow",
  ".ui-upload",
  ".ui-status--neutral",
  ".ui-status--stale",
  ".ui-task-rail",
  ".ui-task-rail-nav",
  ".ui-task-rail__item",
  ".ui-task-rail__item--current",
  ".ui-task-rail__status",
  ".ui-task-badge",
  ".agent-mark",
  ".agent-mark__badge",
  ".mode-choice",
] as const;

const GROUP_2B_02_CLASSES = [
  ".ui-app",
  ".ui-app__col",
  ".ui-app__main",
  ".ui-app__main--task",
  ".ui-app__foot",
  ".ui-appbar",
  ".ui-appbar--root",
  ".ui-appbar--task",
  ".ui-appbar__brand",
  ".ui-appbar__grow",
  ".ui-appbar__action",
  ".ui-appbar__help",
  ".ui-appbar__label",
  ".ui-appbar__title",
  ".ui-mode-label",
  ".ui-mode-label--control",
  ".ui-mode-label__mark",
  ".ui-mode-label__prefix",
  ".ui-mode-label__mode",
  ".ui-agent-mark",
  ".ui-agent-mark__face",
  ".ui-badge",
  ".ui-rail-nav",
  ".ui-rail",
  ".ui-rail-nav__compact",
  ".ui-rail-nav__bar",
  ".ui-sidenav",
  ".ui-sidenav--guest",
  ".ui-sidenav__brand",
  ".ui-brand",
  ".ui-sidenav__list",
  ".ui-sidenav__list--end",
  ".ui-sidenav__who",
  ".ui-sidenav-compact",
  ".ui-sidenav-compact__bar",
  ".ui-sidenav-compact__section",
  ".ui-sidenav-compact__toggle",
  ".ui-dialog",
  ".ui-dialog__head",
  ".ui-dialog__title",
  ".ui-dialog__actions",
  ".ui-page--short",
] as const;

const GROUP_2B_03_CLASSES = [
  ".ui-ticket",
  ".ui-ticket__eyebrow",
  ".ui-ticket__name",
  ".ui-ticket__dates",
  ".ui-ticket__date",
  ".ui-ticket__date--end",
  ".ui-ticket__label",
  ".ui-ticket__day",
  ".ui-ticket__time",
  ".ui-ticket__arrow",
  ".ui-ticket__foot",
  ".ui-price-breakdown",
  ".ui-price-breakdown--band",
  ".ui-price-breakdown__condition",
  ".ui-price-breakdown__label",
  ".ui-price-breakdown__row",
  ".ui-price-breakdown__value",
  ".ui-price-breakdown__due",
  ".ui-price-breakdown__paid",
  ".ui-tiles",
  ".ui-tiles__tile",
  ".ui-steps",
  ".ui-steps--compact",
] as const;

const GROUP_2B_04_CLASSES = [
  ".ui-segmented",
  ".ui-list",
  ".ui-list__row",
  ".ui-list__row--static",
  ".ui-list__primary",
  ".ui-list__secondary",
  ".ui-list__aside",
  ".ui-list__aside--money",
  ".ui-list__status",
  ".ui-result-rows",
  ".ui-result-row",
  ".ui-result-row--muted",
  ".ui-result-row--no-thumb",
  ".ui-result-row__thumb",
  ".ui-result-row__body",
  ".ui-result-row__title",
  ".ui-result-row__where",
  ".ui-result-row__price",
  ".ui-result-row__next",
  ".ui-stay-card",
  ".ui-stay-card__media",
  ".ui-stay-card__photo",
  ".ui-stay-card__photo--empty",
  ".ui-stay-card__count",
  ".ui-stay-card__label",
  ".ui-stay-card__body",
  ".ui-stay-card__where",
  ".ui-stay-card__title",
  ".ui-stay-card__facts",
  ".ui-stay-card__total",
] as const;

const GROUP_2B_05_CLASSES = [
  ".ui-conversation",
  ".ui-persona",
  ".ui-persona__mark",
  ".ui-persona__mode",
  ".ui-persona--human",
  ".ui-message",
  ".ui-message--guest",
  ".ui-chips",
  ".ui-chip",
  ".ui-chip--add",
  ".ui-chip--demo",
  ".ui-composer",
  ".ui-composer__input",
  ".ui-composer__send",
  ".ui-chooser",
  ".ui-chooser--dialog",
  ".ui-chooser__options",
  ".ui-chooser__option",
  ".ui-chooser__text",
  ".ui-chooser__line",
  ".ui-domain-tag",
  ".ui-switch-divider",
  ".ui-switch-divider__text",
] as const;

const GROUP_2B_06_CLASSES = [
  ".ui-chat-card",
  ".ui-chat-card__head",
  ".ui-chat-card__title",
  ".ui-chat-card__aside",
  ".ui-chat-card__rows",
  ".ui-chat-card__row",
  ".ui-action-bar--sticky",
  ".ui-confirm",
  ".ui-confirm__body",
  ".ui-effect",
  ".ui-effect__title",
  ".ui-effect__body",
  ".ui-panel--commit",
  ".ui-panel__title",
] as const;

const GROUP_2B_07_CLASSES = [
  ".ui-shell",
  ".ui-shell__main",
  ".ui-breadcrumb",
  ".ui-queue",
  ".ui-queue-item",
  ".ui-queue-item__what",
  ".ui-queue-item__kind",
  ".ui-queue-item__title",
  ".ui-queue-item__detail",
  ".ui-queue-item__action",
  ".ui-outcome",
  ".ui-outcome--success",
  ".ui-outcome--declined",
  ".ui-outcome__title",
  ".ui-outcome__body",
  ".ui-panel--commit",
  ".ui-panel__title",
  ".ui-effect",
  ".ui-effect__title",
  ".ui-effect__body",
  ".ui-transfer",
  ".ui-transfer__side",
  ".ui-reference",
  ".ui-receipt",
  ".ui-receipt__meta",
  ".ui-receipt__frame",
  ".ui-receipt__label",
  ".ui-receipt__file",
  ".ui-receipt__name",
  ".ui-receipt__gone",
] as const;

test("I3: zero board-only classes (xk-*, bd-*) appear anywhere in apps/", () => {
  assert.ok(BOARD_ONLY_CLASSES.length >= 30, "extracted board-only class list from xenia-kit.css");
  const appFiles = walkTsCssHtml(new URL("../apps", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
  const pattern = new RegExp(`(?<![\\w-])(?:${BOARD_ONLY_CLASSES.join("|")})(?![\\w-])`);
  for (const file of appFiles) {
    const content = readFileSync(file, "utf8");
    const match = pattern.exec(content);
    assert.equal(match, null, `${file} must never contain board-only class ${match?.[0]}`);
  }
});

test("I3 (2b-01..2b-07): every mapped class and preserved code-only class exists in shortlet-foundations.css", () => {
  for (const cls of GROUP_2B_01_CLASSES) {
    assert.ok(FOUNDATIONS_CSS.includes(cls), `missing 2b-01 class ${cls} in shortlet-foundations.css`);
  }
  for (const cls of GROUP_2B_02_CLASSES) {
    assert.ok(FOUNDATIONS_CSS.includes(cls), `missing 2b-02 class ${cls} in shortlet-foundations.css`);
  }
  for (const cls of GROUP_2B_03_CLASSES) {
    assert.ok(FOUNDATIONS_CSS.includes(cls), `missing 2b-03 class ${cls} in shortlet-foundations.css`);
  }
  for (const cls of GROUP_2B_04_CLASSES) {
    assert.ok(FOUNDATIONS_CSS.includes(cls), `missing 2b-04 class ${cls} in shortlet-foundations.css`);
  }
  for (const cls of GROUP_2B_05_CLASSES) {
    assert.ok(FOUNDATIONS_CSS.includes(cls), `missing 2b-05 class ${cls} in shortlet-foundations.css`);
  }
  for (const cls of GROUP_2B_06_CLASSES) {
    assert.ok(FOUNDATIONS_CSS.includes(cls), `missing 2b-06 class ${cls} in shortlet-foundations.css`);
  }
  for (const cls of GROUP_2B_07_CLASSES) {
    assert.ok(FOUNDATIONS_CSS.includes(cls), `missing 2b-07 class ${cls} in shortlet-foundations.css`);
  }
  for (const cls of PRESERVED_CODE_CLASSES) {
    assert.ok(FOUNDATIONS_CSS.includes(cls), `missing preserved code-only class ${cls} in shortlet-foundations.css`);
  }
});

test("I2: no raw hex colours outside the theme token blocks and no --mode-* on buttons, status, banners, or money", () => {
  const outside = FOUNDATIONS_CSS
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/:root\s*\{[^}]*\}/g, "")
    .replace(/:root\[data-theme="dark"\]\s*\{[^}]*\}/g, "")
    .replace(/:root\[data-theme="system"\]\s*\{[^}]*\}/g, "");
  assert.deepEqual(outside.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [], []);

  for (const match of FOUNDATIONS_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!;
    const body = match[2]!;
    if (/\.ui-button|\.ui-money-|\.ui-status|\.ui-banner/.test(selector)) {
      assert.doesNotMatch(body, /var\(--mode-/, `${selector.trim()} never uses a --mode-* token`);
    }
  }
});

test("Step 0: [hidden] base rule hides hidden kit elements while preserving hidden='until-found'", () => {
  assert.match(
    FOUNDATIONS_CSS,
    /\[hidden\]:not\(\[hidden=["']until-found["']\]\)\s*\{\s*display:\s*none\s*!important;\s*\}/,
  );
});
