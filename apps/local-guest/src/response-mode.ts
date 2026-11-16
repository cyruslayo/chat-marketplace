import { validateModePresentation, type ModePresentation } from "../../web-agent/src/guest-content.js";

/**
 * The response-mode check the browser client applies to every guest response (ADR 0107). Kept free of DOM access and
 * module-scope side effects so node can import it and test the client's refusal directly. An absent mode is allowed;
 * a present mode must pass validateModePresentation or the response is refused.
 */
export function assertValidResponseMode(value: unknown): void {
  if (value === undefined) return;
  if (validateModePresentation(value) === undefined) throw new Error("Invalid response mode");
}

/** The validated, frozen copy of a response mode, or undefined when the mode is absent or malformed (ADR 0107). */
export function readResponseMode(value: unknown): ModePresentation | undefined {
  return validateModePresentation(value);
}

/**
 * Issue 03c (ADR 0107 decisions 2 and 6): writes the response's mode id to the document's data-mode, and only from a validated
 * presentation. An absent or malformed mode leaves the attribute as it is. The client never sets the mode from a user action.
 * Returns true only when the mode id changed (issue 03k writes the browser theme colour on that change, and only then).
 */
export function applyResponseModeTo(root: { readonly dataset: Record<string, string | undefined> }, value: unknown): boolean {
  const mode = readResponseMode(value);
  if (mode === undefined || root.dataset.mode === mode.id) return false;
  root.dataset.mode = mode.id;
  return true;
}

const COLOUR_PATTERN = /^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]+\))$/;

/** A computed colour string that a browser accepts for theme-color, or null. Empty, unparseable or non-string values fail closed. */
export function validateThemeColour(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const colour = value.trim();
  return COLOUR_PATTERN.test(colour) ? colour : null;
}

/** The theme-color metas the client writes to. A DOM meta element satisfies this shape. */
export interface ThemeColourMeta {
  content: string;
}

/**
 * Writes the validated, current --mode-tint to every theme-color meta. When the read is not a valid colour, the previous
 * content stays and nothing is written (issue 03k AC 7, fail closed).
 */
export function writeThemeColour(metas: readonly ThemeColourMeta[], readTint: () => string): void {
  const colour = validateThemeColour(readTint());
  if (colour === null) return;
  for (const meta of metas) meta.content = colour;
}

/**
 * Issue 03k: applies a guest response's mode and, only when its id changed, writes the theme colour. A mode that is absent or
 * malformed writes nothing. Only the validated response reaches this path: chips, the strip and the sheet never call it.
 */
export function applyResponseModeAndThemeColour(
  root: { readonly dataset: Record<string, string | undefined> },
  metas: readonly ThemeColourMeta[],
  readTint: () => string,
  value: unknown,
): void {
  if (!applyResponseModeTo(root, value)) return;
  writeThemeColour(metas, readTint);
}

/** Re-runs the write when the operating system's colour scheme changes, but only while the page follows the system (issue 03k). */
export function refreshThemeColourOnSchemeChange(
  root: { readonly dataset: Record<string, string | undefined> },
  metas: readonly ThemeColourMeta[],
  readTint: () => string,
): void {
  if (root.dataset.theme !== "system") return;
  writeThemeColour(metas, readTint);
}
