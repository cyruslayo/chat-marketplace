import { escapeHtml, icon, pageShell, type IconName } from "../../web/src/ui-kit.js";

/**
 * The back-office layout: every `/operator/*` page except sign-in renders through `backOfficePage`,
 * so your name, the navigation and Log out sit in one shared header (B1 AC1).
 * Back-office-only rules use `bo-` classes here; shortlet-foundations.css and Guest pages are unchanged.
 */

export type BackOfficeSection = "home" | "requests";

interface NavLink { readonly section: BackOfficeSection; readonly href: string; readonly label: string; readonly icon: IconName }

/** Links only for shipped slices. Later slices add one entry here (and a section name above). */
export const BACK_OFFICE_NAV: readonly NavLink[] = Object.freeze([
  { section: "home", href: "/operator", label: "Home", icon: "home" },
  { section: "requests", href: "/operator/requests", label: "Requests", icon: "inbox" },
]);

/** ADR 0078: 44px targets (--control-min-target) and a header that wraps at 320px instead of scrolling. */
const BACK_OFFICE_STYLE = [
  ".bo-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-2) var(--space-4);padding-block-end:var(--space-3);border-block-end:1px solid var(--color-border-subtle)}",
  ".bo-header__who{margin:0;min-inline-size:0;overflow-wrap:anywhere}",
  ".bo-header__who strong{display:block;color:var(--color-text)}",
  ".bo-header__nav{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center}",
  ".bo-header__nav ul{display:flex;flex-wrap:wrap;gap:var(--space-2);margin:0;padding:0;list-style:none}",
  ".bo-header__nav a,.bo-header .ui-button{min-block-size:var(--control-min-target);min-inline-size:var(--control-min-target)}",
  ".bo-header__nav a[aria-current=page]{text-decoration:underline;text-underline-offset:0.3em}",
  ".bo-header form{margin:0}",
  ".bo-waiting{display:grid;gap:var(--space-3);margin:0;padding:0;list-style:none}",
  ".bo-waiting__item a{display:grid;gap:var(--space-1);min-block-size:var(--control-min-target);padding:var(--space-4);border:1px solid var(--color-border-subtle);border-radius:var(--radius-card);background:var(--color-surface);color:inherit;text-decoration:none;overflow-wrap:anywhere}",
  ".bo-waiting__item a:hover{border-color:var(--color-border)}",
  ".bo-waiting__item a:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}",
  ".bo-waiting__title{font-weight:600;color:var(--color-text)}",
  ".ui-panel h2{margin:0;font-size:var(--font-size-h3);line-height:var(--font-line-h3)}",
  ".ui-panel p{margin:0}",
].join("");

export interface BackOfficeViewer {
  /** Your display name. Never an actor id (ADR 0075). */
  readonly name: string;
}

export interface BackOfficePageOptions {
  readonly title: string;
  readonly viewer: BackOfficeViewer;
  readonly current: BackOfficeSection;
  /** Pre-rendered, already-escaped markup placed after the shared header. */
  readonly body: string;
  readonly style?: string;
}

export function backOfficeHeader(viewer: BackOfficeViewer, current: BackOfficeSection): string {
  const links = BACK_OFFICE_NAV.map((link) => `<li><a class="ui-button ui-button--quiet" href="${link.href}"${link.section === current ? ' aria-current="page"' : ""}>${icon(link.icon)}${escapeHtml(link.label)}</a></li>`).join("");
  return `<header class="bo-header"><p class="bo-header__who"><span class="ui-eyebrow">Shortlet back office</span><strong>${escapeHtml(viewer.name)}</strong></p><nav class="bo-header__nav" aria-label="Back office"><ul>${links}</ul><form method="post" action="/operator/logout"><button class="ui-button ui-button--quiet" type="submit">Log out</button></form></nav></header>`;
}

export function backOfficePage(options: BackOfficePageOptions): string {
  return pageShell({
    title: `${options.title} · Back office`,
    style: BACK_OFFICE_STYLE + (options.style ?? ""),
    body: backOfficeHeader(options.viewer, options.current) + options.body,
  });
}

/** Absolute WAT time (ADR 0078): relative time never replaces it. */
export function formatWat(iso: string): string {
  return new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + " WAT";
}

/** A `<time>` carrying the projected instant (ADR 0077) and its absolute WAT rendering. */
export function watTime(iso: string): string {
  return `<time datetime="${escapeHtml(iso)}">${escapeHtml(formatWat(iso))}</time>`;
}

/** Sign-in reasons carried as fixed codes in the query string; never free text or ids (B1 AC3, ADR 0086). */
export const SIGN_IN_REASONS = Object.freeze({
  expired: "Your session has ended. Sign in again with a new access token.",
  "signed-out": "You were signed out. Sign in again with a new access token.",
} as const);

export type SignInReason = keyof typeof SIGN_IN_REASONS;

export function signInReason(value: string | null): SignInReason | null {
  return value !== null && Object.hasOwn(SIGN_IN_REASONS, value) ? value as SignInReason : null;
}
