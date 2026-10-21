import assert from "node:assert/strict";

/** Marker comments around the one colour token block at the top of shortlet-landing.css (owner decision, 14 Oct 2026). */
export const LANDING_TOKEN_BLOCK_START = "/* landing-brand-tokens:start */";
export const LANDING_TOKEN_BLOCK_END = "/* landing-brand-tokens:end */";

export type LandingTokenTheme = "light" | "dark" | "system";
export type LandingTokenSets = Readonly<Record<LandingTokenTheme, Readonly<Record<string, string>>>>;

/** WCAG 2.x relative luminance of an sRGB colour with 0 to 255 channels (the one formula every contrast check uses). */
export function relativeLuminanceRgb(red: number, green: number, blue: number): number {
  const linear = [red, green, blue].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/** WCAG 2.x relative luminance of a six-digit hex colour. */
export function relativeLuminance(hex: string): number {
  const channels = /^#([0-9a-fA-F]{6})$/.exec(hex)?.[1]?.match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16));
  assert.ok(channels, `${hex} is a six-digit hex colour`);
  return relativeLuminanceRgb(channels[0]!, channels[1]!, channels[2]!);
}

/** WCAG 2.x contrast ratio between two relative luminances, from 1 to 21. */
export function contrastRatioOfLuminances(first: number, second: number): number {
  const [high, low] = [first, second].sort((a, b) => b - a);
  return (high! + 0.05) / (low! + 0.05);
}

/** WCAG 2.x contrast ratio between two six-digit hex colours, from 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  return contrastRatioOfLuminances(relativeLuminance(first), relativeLuminance(second));
}

/**
 * The text between the landing token markers, exclusive. Fails unless each marker appears exactly once and in order.
 * Only this block may hold colour literals in shortlet-landing.css.
 */
export function landingTokenBlock(css: string): string {
  const starts = css.split(LANDING_TOKEN_BLOCK_START).length - 1;
  const ends = css.split(LANDING_TOKEN_BLOCK_END).length - 1;
  assert.equal(starts, 1, "the landing token block start marker appears exactly once");
  assert.equal(ends, 1, "the landing token block end marker appears exactly once");
  const from = css.indexOf(LANDING_TOKEN_BLOCK_START);
  const to = css.indexOf(LANDING_TOKEN_BLOCK_END);
  assert.ok(from < to, "the landing token block start marker comes before its end marker");
  return css.slice(from + LANDING_TOKEN_BLOCK_START.length, to);
}

/** The stylesheet with the marked token block (markers included) removed. */
export function stripLandingTokenBlock(css: string): string {
  landingTokenBlock(css);
  const from = css.indexOf(LANDING_TOKEN_BLOCK_START);
  const to = css.indexOf(LANDING_TOKEN_BLOCK_END) + LANDING_TOKEN_BLOCK_END.length;
  return css.slice(0, from) + css.slice(to);
}

/**
 * Parses the token block into resolved value sets for the light (:root), dark (:root[data-theme="dark"]) and
 * system-dark (@media prefers-color-scheme: dark, :root[data-theme="system"]) themes. var(--landing-*) references are
 * resolved within the same theme set, so every returned value is a literal such as a hex colour or rgba().
 */
export function landingTokenSets(css: string): LandingTokenSets {
  const block = landingTokenBlock(css);
  const raw = {
    light: declarations(block, /:root\s*\{([^}]*)\}/g),
    dark: declarations(block, /:root\[data-theme="dark"\]\s*\{([^}]*)\}/g),
    system: declarations(block, /:root\[data-theme="system"\]\s*\{([^}]*)\}/g),
  } satisfies Record<LandingTokenTheme, Record<string, string>>;
  return {
    light: resolveSet(raw.light, "light"),
    dark: resolveSet(raw.dark, "dark"),
    system: resolveSet(raw.system, "system"),
  };
}

function declarations(block: string, selector: RegExp): Record<string, string> {
  const found: Record<string, string> = {};
  for (const rule of block.matchAll(selector)) {
    for (const declaration of rule[1]!.matchAll(/(--landing-[\w-]+)\s*:\s*([^;]+?)\s*;/g)) {
      assert.equal(found[declaration[1]!], undefined, `${declaration[1]} is declared once per theme`);
      found[declaration[1]!] = declaration[2]!;
    }
  }
  return found;
}

function resolveSet(set: Record<string, string>, theme: LandingTokenTheme): Record<string, string> {
  assert.ok(Object.keys(set).length > 0, `the ${theme} token set defines landing tokens`);
  const resolved: Record<string, string> = {};
  for (const name of Object.keys(set)) resolved[name] = resolveValue(set, name, theme, new Set());
  return resolved;
}

function resolveValue(set: Record<string, string>, name: string, theme: LandingTokenTheme, visiting: Set<string>): string {
  const value = set[name]!;
  const reference = /^var\((--landing-[\w-]+)\)$/.exec(value)?.[1];
  if (!reference) return value;
  assert.ok(!visiting.has(reference), `${name} in the ${theme} set does not reference itself`);
  assert.notEqual(set[reference], undefined, `${name} in the ${theme} set references a token that is defined there`);
  visiting.add(name);
  return resolveValue(set, reference, theme, visiting);
}
