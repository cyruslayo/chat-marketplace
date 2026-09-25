/**
 * Server-rendered building blocks for conventional (non-Weaver) Shortlet pages.
 * Styling lives in shortlet-foundations.css; these helpers only emit markup that
 * uses the shared ui-* classes, so Guest and Operator pages stay visually consistent.
 */

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/**
 * The single NGN display format (ADR-0078: money is stored in kobo and shown unambiguously).
 * Whole naira are shown without decimals; kobo appear only when non-zero (₦202,000, ₦18,450.50).
 */
export function formatMoney(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const absoluteKobo = Math.abs(kobo);
  const wholeNaira = Math.floor(absoluteKobo / 100);
  const remainderKobo = absoluteKobo % 100;
  const digits = String(wholeNaira);
  const firstGroupLength = digits.length % 3 || 3;
  const grouped = [digits.slice(0, firstGroupLength), ...digits.slice(firstGroupLength).match(/.{3}/g) ?? []].join(",");
  const fraction = remainderKobo === 0 ? "" : `.${String(remainderKobo).padStart(2, "0")}`;
  return `${sign}₦${grouped}${fraction}`;
}

const ICON_PATHS = {
  "arrow-left": '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  alert: '<path d="M12 3.5 2.5 20h19Z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6.5 15h4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  home: '<path d="M3.5 11 12 4l8.5 7M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6H3v-6Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Decorative inline icon; pair with visible text or an aria-label on the control. */
export function icon(name: IconName): string {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "stale";

export function statusBadge(label: string, tone: StatusTone): string {
  return `<span class="ui-status ui-status--${tone}">${escapeHtml(label)}</span>`;
}

export interface PageShellOptions {
  readonly title: string;
  /** Pre-rendered, already-escaped body markup placed inside <main>. */
  readonly body: string;
  readonly width?: "default" | "narrow";
  /** "system" follows the OS colour scheme; "light" keeps the page light-only. */
  readonly theme?: "system" | "light" | "dark";
  /** Page-specific rules; keep these to layout that the shared components do not cover. */
  readonly style?: string;
}

export function pageShell(options: PageShellOptions): string {
  const theme = options.theme ?? "system";
  const widthClass = options.width === "narrow" ? "ui-page ui-page--narrow" : "ui-page";
  const style = options.style ? `<style>${options.style}</style>` : "";
  return `<!doctype html><html lang="en-NG" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(options.title)}</title><link rel="stylesheet" href="/shortlet-foundations.css">${style}</head><body><main class="${widthClass}">${options.body}</main></body></html>`;
}

export interface ErrorPageOptions {
  readonly status: number;
  /** Machine-readable code, kept on the page for support and tests. */
  readonly code: string;
  readonly title: string;
  readonly message: string;
  readonly action?: { readonly href: string; readonly label: string };
}

export function errorPage(options: ErrorPageOptions): string {
  const artIcon: IconName = options.status === 401 || options.status === 403 ? "info" : options.status === 404 ? "search" : "alert";
  const action = options.action ? `<a class="ui-button ui-button--primary" href="${escapeHtml(options.action.href)}">${escapeHtml(options.action.label)}</a>` : "";
  return pageShell({
    title: `${options.title} · Shortlet`,
    width: "narrow",
    body: `<section class="ui-panel ui-empty" data-error-code="${escapeHtml(options.code)}" data-status="${options.status}"><div class="ui-empty__art">${icon(artIcon)}</div><h1>${escapeHtml(options.title)}</h1><p>${escapeHtml(options.message)}</p>${action}</section>`,
  });
}

/** Browser navigations (Accept: text/html) get a styled page; API clients keep JSON. */
export function prefersHtml(acceptHeader: string | undefined): boolean {
  return typeof acceptHeader === "string" && /\btext\/html\b/i.test(acceptHeader);
}
