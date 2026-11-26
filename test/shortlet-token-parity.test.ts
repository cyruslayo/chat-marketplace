import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contrastRatio } from "./helpers/landing-tokens.js";
import { modeTokens, resolveToken, themeColors, type ModeTheme } from "./helpers/mode-tokens.js";

interface PinnedTokensJson {
  readonly color: {
    readonly tokens: readonly {
      readonly name: string;
      readonly value: { readonly light: string; readonly dark: string };
    }[];
  };
  readonly type: {
    readonly families: { readonly display: string; readonly sans: string };
  };
  readonly spacing: {
    readonly tokens: readonly { readonly name: string; readonly value: string }[];
  };
  readonly radius: {
    readonly tokens: readonly { readonly name: string; readonly value: string }[];
  };
}

const PINNED_TOKENS = JSON.parse(
  readFileSync(
    new URL("../.scratch/app-expansion/design/round-12/tokens.json", import.meta.url),
    "utf8",
  ),
) as PinnedTokensJson;

const FOUNDATIONS_CSS = readFileSync(
  new URL("../apps/web/src/shortlet-foundations.css", import.meta.url),
  "utf8",
);

/**
 * Single authoritative mapping from pinned Xenia colour tokens (tokens.json)
 * to Shortlet's semantic foundation tokens (AGENTS.md + parity audit §5).
 */
const XENIA_TO_CODE_TOKEN: Readonly<Record<string, string>> = {
  "--canvas": "--color-canvas",
  "--surface": "--color-surface",
  "--surface-subtle": "--color-surface-subtle",
  "--ink": "--color-text",
  "--ink-secondary": "--color-text-secondary",
  "--ink-muted": "--color-text-muted",
  "--border": "--color-border",
  "--border-subtle": "--color-border-subtle",
  "--indigo": "--color-action",
  "--indigo-hover": "--color-action-hover",
  "--indigo-pressed": "--color-action-pressed",
  "--on-indigo": "--color-on-action",
  "--indigo-subtle": "--color-action-subtle",
  "--indigo-deep": "--color-surface-inverse",
  "--on-indigo-deep": "--color-text-on-inverse",
  "--sand": "--color-accent-on-inverse",
  "--sand-ink": "--color-accent-ink",
  "--focus": "--color-focus",
  "--success": "--color-success",
  "--success-surface": "--color-success-surface",
  "--warning": "--color-warning",
  "--warning-surface": "--color-warning-surface",
  "--danger": "--color-danger",
  "--danger-surface": "--color-danger-surface",
  "--stays-accent": "--color-accent",
  "--stays-subtle": "--color-accent-subtle",
};

/** Unregistered domain tokens in Xenia; deferred until those packs exist (ADR 0107 decision 10, kickoff I10). */
const DEFERRED_MODE_TOKENS = new Set([
  "--events-accent",
  "--events-subtle",
  "--community-accent",
  "--community-subtle",
  "--services-accent",
  "--services-subtle",
]);

const RADIUS_TO_CODE_TOKEN: Readonly<Record<string, string>> = {
  "radius-sm": "--radius-small",
  "radius-md": "--radius-control",
  "radius-lg": "--radius-card",
  "radius-xl": "--radius-workspace",
  "radius-pill": "--radius-pill",
};

function pxToRem(px: string): string {
  const numeric = Number.parseFloat(px.replace(/px$/, ""));
  return `${numeric / 16}rem`;
}

function extractThemeTokenMap(theme: "light" | "dark"): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const token of PINNED_TOKENS.color.tokens) {
    colors[`--${token.name}`] = token.value[theme].toUpperCase();
  }
  return colors;
}

function stripThemeBlocksAndComments(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/:root\s*\{[^}]*\}/g, "")
    .replace(/:root\[data-theme="dark"\]\s*\{[^}]*\}/g, "")
    .replace(/:root\[data-theme="system"\]\s*\{[^}]*\}/g, "");
}

test("AC1 & I2: every pinned Xenia colour token in tokens.json maps onto shortlet-foundations.css in light, dark, and system-dark without drift", () => {
  const xeniaLight = extractThemeTokenMap("light");
  const xeniaDark = extractThemeTokenMap("dark");

  const allXeniaTokens = new Set([...Object.keys(xeniaLight), ...Object.keys(xeniaDark)]);
  for (const xeniaName of allXeniaTokens) {
    assert.ok(
      xeniaName in XENIA_TO_CODE_TOKEN || DEFERRED_MODE_TOKENS.has(xeniaName),
      `pinned Xenia token ${xeniaName} is either mapped or explicitly deferred`,
    );
  }
  for (const deferred of DEFERRED_MODE_TOKENS) {
    assert.doesNotMatch(FOUNDATIONS_CSS, new RegExp(`${deferred}:`), `deferred token ${deferred} is not added yet`);
  }

  const themeSources: ReadonlyArray<readonly [ModeTheme, Record<string, string>]> = [
    ["light", xeniaLight],
    ["dark", xeniaDark],
    ["system", xeniaDark],
  ];
  for (const [theme, pinned] of themeSources) {
    const codeTokens = themeColors(FOUNDATIONS_CSS, theme);
    for (const [xeniaName, codeName] of Object.entries(XENIA_TO_CODE_TOKEN)) {
      const expected = pinned[xeniaName];
      assert.ok(expected, `${xeniaName} exists in pinned tokens.json ${theme}`);
      const actual = codeTokens[codeName];
      assert.ok(actual, `${codeName} exists in foundations ${theme}`);
      assert.equal(actual.toUpperCase(), expected, `${theme}: ${codeName} (${actual}) matches pinned ${xeniaName} (${expected})`);
    }
  }

  // Spacing & radius parity with tokens.json
  const rootMatch = /:root\s*\{([^}]*)\}/.exec(FOUNDATIONS_CSS);
  assert.ok(rootMatch, ":root block exists");
  const rootBody = rootMatch[1]!;
  for (const space of PINNED_TOKENS.spacing.tokens) {
    const expectedRem = pxToRem(space.value);
    assert.match(rootBody, new RegExp(`--${space.name}:\\s*${expectedRem.replace(".", "\\.")};`), `spacing --${space.name}`);
  }
  for (const radius of PINNED_TOKENS.radius.tokens) {
    const codeName = RADIUS_TO_CODE_TOKEN[radius.name];
    assert.ok(codeName, `radius ${radius.name} mapped`);
    const expected = radius.name === "radius-pill" ? radius.value : pxToRem(radius.value);
    assert.match(rootBody, new RegExp(`${codeName}:\\s*${expected.replace(".", "\\.")};`), `radius ${codeName}`);
  }
  assert.match(PINNED_TOKENS.type.families.display, /Newsreader/);
  assert.match(PINNED_TOKENS.type.families.sans, /Hanken Grotesk/);
});

test("I2: no hex colour literals exist outside the theme token blocks of shortlet-foundations.css", () => {
  const outside = stripThemeBlocksAndComments(FOUNDATIONS_CSS);
  const strayHexes = outside.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [];
  assert.deepEqual(strayHexes, [], `no hex literals outside :root theme blocks: ${strayHexes.join(", ")}`);
});

test("AC2: all mapped and derived Xenia token pairs meet WCAG 2.2 AA in light, dark, and system-dark", () => {
  const pairs: ReadonlyArray<readonly [string, string, string, number]> = [
    ["text / canvas", "--color-text", "--color-canvas", 4.5],
    ["text / surface", "--color-text", "--color-surface", 4.5],
    ["text-secondary / canvas", "--color-text-secondary", "--color-canvas", 4.5],
    ["text-muted / canvas", "--color-text-muted", "--color-canvas", 4.5],
    ["text-muted / surface-subtle", "--color-text-muted", "--color-surface-subtle", 4.5],
    ["on-action / action", "--color-on-action", "--color-action", 4.5],
    ["action / surface", "--color-action", "--color-surface", 4.5],
    ["text-on-inverse / surface-inverse", "--color-text-on-inverse", "--color-surface-inverse", 4.5],
    ["text-on-inverse-muted / surface-inverse", "--color-text-on-inverse-muted", "--color-surface-inverse", 4.5],
    ["accent-on-inverse / surface-inverse", "--color-accent-on-inverse", "--color-surface-inverse", 4.5],
    ["text-on-viewer / surface-viewer", "--color-text-on-viewer", "--color-surface-viewer", 4.5],
    ["accent-ink / canvas", "--color-accent-ink", "--color-canvas", 4.5],
    ["accent-ink / surface", "--color-accent-ink", "--color-surface", 4.5],
    ["accent / surface", "--color-accent", "--color-surface", 4.5],
    ["on-action / accent", "--color-on-action", "--color-accent", 4.5],
    ["border / canvas", "--color-border", "--color-canvas", 3],
    ["border / surface", "--color-border", "--color-surface", 3],
    ["focus / canvas", "--color-focus", "--color-canvas", 3],
    ["focus / surface", "--color-focus", "--color-surface", 3],
    ["success / success-surface", "--color-success", "--color-success-surface", 4.5],
    ["warning / warning-surface", "--color-warning", "--color-warning-surface", 4.5],
    ["danger / danger-surface", "--color-danger", "--color-danger-surface", 4.5],
    ["info / info-surface", "--color-info", "--color-info-surface", 4.5],
  ];

  for (const theme of ["light", "dark", "system"] as const) {
    const colors = themeColors(FOUNDATIONS_CSS, theme);
    for (const [label, fgToken, bgToken, min] of pairs) {
      const fg = resolveToken(colors[fgToken]!, colors);
      const bg = resolveToken(colors[bgToken]!, colors);
      const ratio = contrastRatio(fg, bg);
      assert.ok(ratio >= min, `${theme} ${label} meets ${min}:1 (actual ${ratio.toFixed(2)}:1)`);
    }
  }
});

test("AC3: stays mode uses clay accent rather than action, and actions, money, and status never read --mode-*", () => {
  for (const theme of ["light", "dark", "system"] as const) {
    const colors = themeColors(FOUNDATIONS_CSS, theme);
    const stays = modeTokens(FOUNDATIONS_CSS, "stays", theme);
    const action = resolveToken(colors["--color-action"]!, colors).toUpperCase();
    const actionSubtle = resolveToken(colors["--color-action-subtle"]!, colors).toUpperCase();
    const accent = resolveToken(colors["--color-accent"]!, colors).toUpperCase();
    const accentSubtle = resolveToken(colors["--color-accent-subtle"]!, colors).toUpperCase();

    assert.equal(stays["--mode-accent"]!.toUpperCase(), accent, `${theme} stays --mode-accent equals clay --color-accent`);
    assert.equal(stays["--mode-accent-subtle"]!.toUpperCase(), accentSubtle, `${theme} stays --mode-accent-subtle equals --color-accent-subtle`);
    assert.notEqual(stays["--mode-accent"]!.toUpperCase(), action, `${theme} stays --mode-accent is never --color-action`);
    assert.notEqual(stays["--mode-accent-subtle"]!.toUpperCase(), actionSubtle, `${theme} stays --mode-accent-subtle is never --color-action-subtle`);
  }

  for (const match of FOUNDATIONS_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!;
    const body = match[2]!;
    if (/\.ui-button|\.ui-money-|\.ui-status|\.ui-banner/.test(selector)) {
      assert.doesNotMatch(body, /var\(--mode-/, `${selector.trim()} never uses a --mode-* token`);
    }
  }
});
