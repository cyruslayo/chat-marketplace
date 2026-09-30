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
  "arrow-right": '<path d="M5 12h14M13 18l6-6M13 6l6 6"/>',
  "arrow-up": '<path d="M12 19V5M6 11l6-6 6 6"/>',
  alert: '<path d="M12 3.5 2.5 20h19Z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  bank: '<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/>',
  bath: '<path d="M4 12h16a1 1 0 0 1 1 1v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-2a1 1 0 0 1 1-1zM6 12V5a2 2 0 0 1 2-2h1M7 20l-1 2M17 20l1 2"/>',
  bed: '<path d="M3 7v11M21 18v-6a3 3 0 0 0-3-3h-8v6M3 15h18"/><circle cx="6.5" cy="11.5" r="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6.5 15h4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  "chevron-right": '<path d="M9 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  doc: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2zM9 13h6M9 17h6"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  home: '<path d="M3.5 11 12 4l8.5 7M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6H3v-6Z"/>',
  "message-plus": '<path d="M8 9h8M8 13h5M12 21l-3-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6M16 19h6M19 16v6"/>',
  photo: '<path d="M15 8h.01"/><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 16l5-5c.9-.9 2.1-.9 3 0l5 5M14 14l1-1c.9-.9 2.1-.9 3 0l3 3"/>',
  pin: '<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  upload: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 9l5-5 5 5M12 4v12"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export interface AppBarInput {
  readonly backHref: string;
  readonly backLabel: string;
  readonly action?: { readonly href: string; readonly label: string; readonly icon: IconName };
}

export function appBarHtml(input: AppBarInput): string {
  const action = input.action === undefined ? "" : `<a class="ui-button ui-button--small ui-appbar__action" href="${escapeHtml(input.action.href)}">${icon(input.action.icon)}${escapeHtml(input.action.label)}</a>`;
  return `<header class="ui-appbar"><a class="ui-icon-button" href="${escapeHtml(input.backHref)}" aria-label="${escapeHtml(input.backLabel)}">${icon("arrow-left")}</a><a class="ui-appbar__brand" href="/">Shortlet</a><span class="ui-appbar__grow"></span>${action}</header>`;
}

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
  /** Pre-rendered, already-escaped app frame (top bar and journey rail) placed before <main>. */
  readonly frame?: string;
}

export function pageShell(options: PageShellOptions): string {
  const theme = options.theme ?? "system";
  const widthClass = options.width === "narrow" ? "ui-page ui-page--narrow" : "ui-page";
  const style = options.style ? `<style>${options.style}</style>` : "";
  return `<!doctype html><html lang="en-NG" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(options.title)}</title><link rel="stylesheet" href="/shortlet-foundations.css">${style}</head><body>${options.frame ?? ""}<main class="${widthClass}">${options.body}</main></body></html>`;
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
  const recovery = options.action ?? { href: "/", label: "Back to your conversation" };
  const action = `<a class="ui-button ui-button--primary ui-button--block" href="${escapeHtml(recovery.href)}">${escapeHtml(recovery.label)}</a>`;
  return pageShell({
    title: `${options.title} · Shortlet`,
    width: "narrow",
    frame: appBarHtml({ backHref: recovery.href, backLabel: recovery.label }),
    body: `<section class="ui-panel ui-empty" data-error-code="${escapeHtml(options.code)}" data-status="${options.status}"><div class="ui-empty__art">${icon(artIcon)}</div><h1>${escapeHtml(options.title)}</h1><p>${escapeHtml(options.message)}</p>${action}</section>`,
  });
}

/** Browser navigations (Accept: text/html) get a styled page; API clients keep JSON. */
export function prefersHtml(acceptHeader: string | undefined): boolean {
  return typeof acceptHeader === "string" && /\btext\/html\b/i.test(acceptHeader);
}
