import assert from "node:assert/strict";

// Resolves the Agent Mode tokens (ADR 0107 decision 4) from a stylesheet, so a test can check a mode's pairs in each theme.
// Colour roles are read from the stylesheet's own `:root` blocks; `var(--color-*)` references resolve within the same theme.
// Shared by the stays token test (shipped CSS) and the fake shop test (test/fixtures), so neither copies the other.

export const MODE_TOKEN_NAMES = ["--mode-accent", "--mode-accent-subtle", "--mode-on-accent", "--mode-tint"] as const;
export type ModeTheme = "light" | "dark" | "system";

const LIGHT_ROLES = /:root\s*\{([^}]*)\}/g;
const DARK_ROLES = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/g;
const SYSTEM_ROLES = /:root\[data-theme="system"\]\s*\{([^}]*)\}/g;

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The block selector of one mode id in one theme. Light is `:root[data-mode]`; dark and system add their theme guard. */
function modeBlock(id: string, theme: ModeTheme): RegExp {
  const mode = escapeForRegExp(`[data-mode="${id}"]`);
  const prefixes: Readonly<Record<ModeTheme, string>> = {
    light: escapeForRegExp(":root") + mode,
    dark: escapeForRegExp(':root[data-theme="dark"]') + mode,
    system: escapeForRegExp(':root:not([data-theme="light"])') + mode,
  };
  return new RegExp(`${prefixes[theme]}\\s*\\{([^}]*)\\}`, "g");
}

/** Every custom property declared in the blocks a selector matches; a later block overrides an earlier one. */
function declarations(css: string, selector: RegExp): Record<string, string> {
  const found: Record<string, string> = {};
  for (const block of css.matchAll(selector)) {
    for (const declaration of block[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) found[declaration[1]!] = declaration[2]!.trim();
  }
  return found;
}

/** The colour roles in force for a theme: the light `:root` values, overridden by that theme's block. */
export function themeColors(css: string, theme: ModeTheme): Record<string, string> {
  const light = declarations(css, LIGHT_ROLES);
  if (theme === "light") return light;
  return { ...light, ...declarations(css, theme === "dark" ? DARK_ROLES : SYSTEM_ROLES) };
}

/** A declared value with its `var(--name)` references resolved against the theme's colour roles. Fails on a missing role. */
export function resolveToken(value: string, colors: Readonly<Record<string, string>>, depth = 0): string {
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (!reference) return value;
  assert.ok(depth < 8, `${value} resolves without a cycle`);
  const next = colors[reference[1]!];
  assert.ok(next !== undefined, `${reference[1]} is declared for this theme`);
  return resolveToken(next, colors, depth + 1);
}

/**
 * The four mode tokens for one mode id in one theme, resolved to literals. The light block is the base, and a dark or
 * system block overrides it. A missing token fails the assertion, so an incomplete block cannot pass.
 */
export function modeTokens(css: string, id: string, theme: ModeTheme): Record<string, string> {
  const colors = themeColors(css, theme);
  const declared = { ...declarations(css, modeBlock(id, "light")), ...(theme === "light" ? {} : declarations(css, modeBlock(id, theme))) };
  const resolved: Record<string, string> = {};
  for (const name of MODE_TOKEN_NAMES) {
    assert.ok(declared[name] !== undefined, `${id} declares ${name} in ${theme}`);
    resolved[name] = resolveToken(declared[name]!, colors);
  }
  return resolved;
}
