/*
 * Issue 03k (ADR 0107 decisions 2 and 4): the first-paint theme colours of the shell and the no-JS conversation page. Server-only:
 * the browser bundle never imports this module, so the two stays literals below stay out of client.js. The client reads the
 * resolved --mode-tint at runtime (response-mode.ts), so these values only cover the first paint before any response.
 * They must equal --color-accent-subtle in shortlet-foundations.css (the stays --mode-tint); test/agent-mode-theme-color.test.ts
 * checks the light block and the dark blocks.
 */
export const MODE_THEME_COLOUR_INITIAL: Readonly<Record<"light" | "dark", string>> = Object.freeze({
  light: "#F7E6D8",
  dark: "#3A2518",
});

export type ShellTheme = "light" | "dark";

/** The theme the page resolves to: a forced data-theme wins; only "system" follows the operating system's preference (issue 03k). */
export function resolveShellTheme(dataTheme: string | undefined, systemPrefersDark: boolean): ShellTheme {
  if (dataTheme === "light" || dataTheme === "dark") return dataTheme;
  return systemPrefersDark ? "dark" : "light";
}

/**
 * The two static theme-color tags for the first paint (issue 03k, owner decisions 3 and 4): one without a media condition and one
 * with (prefers-color-scheme: dark). Each carries the colour its resolved theme gets, so a forced theme gives both tags its value.
 */
export function themeColourMetaHtml(dataTheme: string = "system"): string {
  const plain = MODE_THEME_COLOUR_INITIAL[resolveShellTheme(dataTheme, false)];
  const dark = MODE_THEME_COLOUR_INITIAL[resolveShellTheme(dataTheme, true)];
  return `<meta name="theme-color" content="${plain}"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="${dark}">`;
}
