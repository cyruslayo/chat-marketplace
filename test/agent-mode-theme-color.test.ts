import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderGuestShellHtml, renderNoScriptConversationHtml } from "../apps/local-guest/src/guest-server.js";
import { GUEST_MODES, type ModePresentation } from "../apps/web-agent/src/guest-content.js";
import {
  applyResponseModeAndThemeColour,
  refreshThemeColourOnSchemeChange,
  validateThemeColour,
  writeThemeColour,
  type ThemeColourMeta,
} from "../apps/local-guest/src/response-mode.js";
import { MODE_THEME_COLOUR_INITIAL, resolveShellTheme, themeColourMetaHtml } from "../apps/local-guest/src/shell-theme-colour.js";
import { createFakeShopPack } from "./helpers/fake-domain-pack.js";
import { modeTokens, themeColors, type ModeTheme } from "./helpers/mode-tokens.js";

// Issue 03k (ADR 0107 decisions 2, 4, 6; ADR 0080): the browser theme colour is the mode's --mode-tint, read at runtime and
// written to the theme-color metas only from a validated response whose mode id changed. Each criterion is one test.

const SHIPPED_CSS = readFileSync(new URL("../apps/web/src/shortlet-foundations.css", import.meta.url), "utf8");
const SHOP_TOKEN_CSS = readFileSync(new URL("./fixtures/mode-shop-tokens.css", import.meta.url), "utf8");
// The stays block and the test-only shop block, so one lookup resolves either mode in any theme.
const COMBINED_CSS = `${SHIPPED_CSS}\n${SHOP_TOKEN_CSS}`;
const SHOP: ModePresentation = createFakeShopPack().presentation!;
const SOURCE = readFileSync(new URL("../apps/local-guest/src/client.ts", import.meta.url), "utf8");

interface MetaTag {
  readonly media: string | undefined;
  readonly content: string | undefined;
}

/** The theme-color tags in an HTML fragment, in document order. */
function themeMetas(html: string): MetaTag[] {
  return [...html.matchAll(/<meta name="theme-color"([^>]*)>/g)].map((match) => ({
    media: /media="([^"]*)"/.exec(match[1]!)?.[1],
    content: /content="([^"]*)"/.exec(match[1]!)?.[1],
  }));
}

/** Fresh, mutable metas in the state of the first paint (the stays values), as the client sees them after load. */
function firstPaintMetas(): ThemeColourMeta[] {
  return themeMetas(renderGuestShellHtml()).map((meta) => ({ content: meta.content ?? "" }));
}

/** The --mode-tint the browser computes for a mode in a theme: what getComputedStyle returns for the document's current state. */
function computedTint(id: string, theme: ModeTheme): string {
  return modeTokens(COMBINED_CSS, id, theme)["--mode-tint"]!;
}

const NOT_READ = (): string => {
  throw new Error("the computed tint must not be read for a refused mode");
};

test("AC1: The shell head has one theme-color meta without media and one with (prefers-color-scheme: dark), both in the first response", () => {
  const head = renderGuestShellHtml().split("</head>")[0]!;
  const metas = themeMetas(head);
  assert.equal(metas.length, 2, "the head has exactly two theme-color metas");
  assert.equal(metas[0]!.media, undefined, "the first meta has no media condition");
  assert.equal(metas[1]!.media, "(prefers-color-scheme: dark)", "the second meta is the dark-scheme meta");
  assert.equal(metas[0]!.content, MODE_THEME_COLOUR_INITIAL.light, "the light colour is the stays value");
  assert.equal(metas[1]!.content, MODE_THEME_COLOUR_INITIAL.dark, "the dark colour is the stays value");
});

test("AC2: A mode switch sets the meta content to the new mode's --mode-tint for the resolved light theme", () => {
  const root = { dataset: { mode: "stays", theme: "system" } as Record<string, string | undefined> };
  const metas = firstPaintMetas();
  applyResponseModeAndThemeColour(root, metas, () => computedTint("shop", "light"), SHOP);
  assert.equal(root.dataset.mode, "shop", "the mode switched");
  assert.equal(computedTint("shop", "light"), "#EEF4FA", "the shop light tint is the fixture value");
  for (const meta of metas) assert.equal(meta.content, "#EEF4FA", "both tags carry the shop light tint");
});

test("AC3: A mode switch sets the meta content to the new mode's --mode-tint for the resolved forced-dark theme", () => {
  const root = { dataset: { mode: "stays", theme: "dark" } as Record<string, string | undefined> };
  const metas = firstPaintMetas();
  applyResponseModeAndThemeColour(root, metas, () => computedTint("shop", "dark"), SHOP);
  assert.equal(root.dataset.mode, "shop", "the mode switched");
  for (const meta of metas) assert.equal(meta.content, "#15283B", "both tags carry the shop dark tint");
});

test("AC4: A forced data-theme=light on a dark system sets the light colour, because the forced theme wins", () => {
  assert.equal(resolveShellTheme("light", true), "light", "a forced light theme ignores a dark system preference");
  assert.equal(resolveShellTheme("system", true), "dark", "system follows a dark preference");
  const root = { dataset: { mode: "stays", theme: "light" } as Record<string, string | undefined> };
  const metas = firstPaintMetas();
  // The browser's computed tint under data-theme="light" is the light value, whatever the operating system prefers.
  applyResponseModeAndThemeColour(root, metas, () => computedTint("shop", "light"), SHOP);
  for (const meta of metas) assert.equal(meta.content, "#EEF4FA", "the dark-scheme tag takes the forced light colour too");
});

test("AC5: A response with no mode, or a malformed mode, leaves the meta unchanged and throws nothing", () => {
  const malformed: readonly (readonly [string, unknown])[] = [
    ["an absent mode", undefined],
    ["null", null],
    ["a string", "shop"],
    ["an object with an unknown key", { ...SHOP, surprise: "not a field" }],
    ["a presentation with an unknown icon", { ...SHOP, persona: { name: "Shop", icon: "not-a-kit-icon" } }],
  ];
  for (const [label, candidate] of malformed) {
    const root = { dataset: { mode: "stays", theme: "system" } as Record<string, string | undefined> };
    const metas = firstPaintMetas();
    const before = metas.map((meta) => meta.content);
    assert.doesNotThrow(() => applyResponseModeAndThemeColour(root, metas, NOT_READ, candidate), `refusing ${label} throws nothing`);
    assert.equal(root.dataset.mode, "stays", `refusing ${label} keeps the mode`);
    assert.deepEqual(metas.map((meta) => meta.content), before, `refusing ${label} leaves the meta unchanged`);
  }
});

test("AC6: A user action never writes the meta: the client calls the write once, from the validated response, and a repeat of the same mode does not write", () => {
  // A chip, a strip radio or a sheet choice never reaches applyResponseModeAndThemeColour; the client calls it in one place.
  const callSites = SOURCE.match(/applyResponseModeAndThemeColour\(/g) ?? [];
  assert.equal(callSites.length, 1, "the client calls the write once");
  const body = SOURCE.slice(SOURCE.indexOf("function applyResponseMode(response: GuestResponse)"));
  const endOfBody = body.indexOf("\n}\n");
  assert.match(
    body.slice(0, endOfBody),
    /applyResponseModeAndThemeColour\(document\.documentElement, themeColourMetas\(\), readModeTint, committed\);/,
    "the one call is inside applyResponseMode, fed the response's validated mode when the update runs (issue 03j)",
  );
  // A repeat of the same mode id is not a change, so the tint is not read and the meta is not rewritten.
  const root = { dataset: { mode: "shop", theme: "system" } as Record<string, string | undefined> };
  const metas = [{ content: "#EEF4FA" }];
  let reads = 0;
  applyResponseModeAndThemeColour(root, metas, () => { reads += 1; return "#000000"; }, SHOP);
  assert.equal(reads, 0, "a response with the mode already applied does not read the tint");
  assert.equal(metas[0]!.content, "#EEF4FA", "the meta keeps its value");
});

test("AC7: An empty or unparseable token value keeps the previous meta content and writes nothing (fail closed)", () => {
  const unusable = ["", "   ", "not-a-colour", "var(--mode-tint)", "#GGGGGG", "#12345", "url(x)"];
  for (const value of unusable) {
    const metas = firstPaintMetas();
    const before = metas.map((meta) => meta.content);
    assert.doesNotThrow(() => writeThemeColour(metas, () => value), `${JSON.stringify(value)} throws nothing`);
    assert.deepEqual(metas.map((meta) => meta.content), before, `${JSON.stringify(value)} keeps the previous content`);
  }
  assert.equal(validateThemeColour(""), null, "an empty value is refused");
  assert.equal(validateThemeColour(undefined), null, "an absent value is refused");
  assert.equal(validateThemeColour(" #f7e6d8 "), "#f7e6d8", "a padded hex value is accepted and trimmed");
  assert.equal(validateThemeColour("rgb(247, 230, 216)"), "rgb(247, 230, 216)", "a browser-computed rgb value is accepted");
});

test("AC8: Every registered mode id resolves a --mode-tint that the browser accepts as a theme colour, in light and dark", () => {
  // Extends the 03c token-coverage test (test/agent-mode-follows-task.test.ts AC5), which checks each token is a hex colour.
  // This adds the one check the runtime read needs: the tint is a value writeThemeColour accepts.
  for (const presentation of [GUEST_MODES.stays, SHOP]) {
    for (const theme of ["light", "dark"] as const) {
      const tint = computedTint(presentation.id, theme);
      assert.notEqual(tint, "", `${presentation.id} declares --mode-tint in ${theme}`);
      assert.equal(validateThemeColour(tint), tint, `${presentation.id} --mode-tint in ${theme} is an accepted theme colour`);
    }
  }
});

test("Design: the stays initial colours equal --color-accent-subtle in the light block and in every dark block of the shipped stylesheet", () => {
  assert.equal(themeColors(SHIPPED_CSS, "light")["--color-accent-subtle"], MODE_THEME_COLOUR_INITIAL.light, "the light block");
  assert.equal(themeColors(SHIPPED_CSS, "dark")["--color-accent-subtle"], MODE_THEME_COLOUR_INITIAL.dark, "the forced dark block");
  assert.equal(themeColors(SHIPPED_CSS, "system")["--color-accent-subtle"], MODE_THEME_COLOUR_INITIAL.dark, "the system dark block");
  for (const theme of ["light", "dark"] as const) {
    assert.equal(computedTint("stays", theme), MODE_THEME_COLOUR_INITIAL[theme], `the stays --mode-tint in ${theme} is the initial colour`);
  }
});

test("Design: the first paint follows the resolved theme: a forced theme gives both tags its value, system gives light and dark", () => {
  assert.equal(
    themeColourMetaHtml("system"),
    `<meta name="theme-color" content="${MODE_THEME_COLOUR_INITIAL.light}"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="${MODE_THEME_COLOUR_INITIAL.dark}">`,
  );
  for (const theme of ["light", "dark"] as const) {
    const metas = themeMetas(themeColourMetaHtml(theme));
    assert.deepEqual(metas.map((meta) => meta.content), [MODE_THEME_COLOUR_INITIAL[theme], MODE_THEME_COLOUR_INITIAL[theme]], `${theme} is forced on both tags`);
  }
});

test("Design: a system scheme change re-reads the tint only while the page follows the system", () => {
  const metas = firstPaintMetas();
  const system = { dataset: { mode: "shop", theme: "system" } as Record<string, string | undefined> };
  refreshThemeColourOnSchemeChange(system, metas, () => computedTint("shop", "dark"));
  for (const meta of metas) assert.equal(meta.content, "#15283B", "a system page takes the new scheme's tint");
  const forced = { dataset: { mode: "shop", theme: "light" } as Record<string, string | undefined> };
  refreshThemeColourOnSchemeChange(forced, metas, NOT_READ);
  for (const meta of metas) assert.equal(meta.content, "#15283B", "a forced page ignores the scheme change");
});

test("Design (ADR 0080 parity): the no-JS conversation page carries the same two static tags with the stays values", () => {
  const page = renderNoScriptConversationHtml({ threadId: "g-03k-theme", timeline: [], surfaces: [] });
  const metas = themeMetas(page.split("</head>")[0]!);
  assert.deepEqual(metas, [
    { media: undefined, content: MODE_THEME_COLOUR_INITIAL.light },
    { media: "(prefers-color-scheme: dark)", content: MODE_THEME_COLOUR_INITIAL.dark },
  ]);
});
