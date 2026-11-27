import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LocalGuestEnvironment } from "../apps/local-guest/src/fixture.js";
import { createGuestRequestHandler, type GuestTurnSuccess } from "../apps/local-guest/src/guest-server.js";
import { SqliteCheckInSupportStore } from "../domains/shortlet/src/checkin-support.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/src/node-sqlite-database.js";
import { LOCAL_COMMERCE_MODULE } from "../apps/local-guest/src/commerce-module-local.js";
import { extendUnit } from "./helpers/demo-extended-journey.js";
import { accountComposition, CapturingEmailSender } from "./helpers/guest-account-sign-in.js";
import { TEST_MANUAL_ACCOUNT } from "./helpers/guest-payment-page.js";
import { guestAction } from "./helpers/guest-restart.js";
import { cookieOf, sendGuest } from "./helpers/guest-route-harness.js";
import { BOOKING_STAGE_PAGES, withStagePage } from "./helpers/guest-stage-pages.js";

// Rules 03 (navigation N1-N11), ADR 0078, ADR 0080, ADR 0107.
// Ratchet for guest routes and navigation reachability: every live guest GET page route must appear
// in GUEST_NAVIGATION_TABLE, every page must have a non-Back exit, every internal link/form target
// must resolve to a served route, and every recorded gap must stay accurate until closed.

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const GUEST_SERVER_PATH = join(REPO_ROOT, "apps/local-guest/src/guest-server.ts");
const LANDING_ROUTE_PATH = join(REPO_ROOT, "apps/local-guest/src/landing-route-module.ts");
const PARTNERS_ROUTE_PATH = join(REPO_ROOT, "apps/local-guest/src/partners-route-module.ts");

export type NavKind = "section" | "task" | "state";
export type NavRuleId = "N1" | "N2" | "N3" | "N4" | "N5" | "N7" | "N11";

export interface NavGap {
  readonly rule: NavRuleId;
  readonly issue: string;
  readonly reason: string;
}

export interface GuestNavigationRow {
  readonly id: string;
  readonly route: string;
  readonly kind: NavKind;
  readonly expectedExits: readonly string[];
  readonly planned?: { readonly issue: string; readonly note: string };
  readonly gaps: readonly NavGap[];
}

export interface NonPageRouteAllowance {
  readonly route: string;
  readonly reason: string;
}

/**
 * Known non-page GET routes in guest-server.ts and landing-route-module.ts.
 * Adding an unlisted route here requires a documented reason; removing a route from code without removing it here fails AC1.
 */
export const NON_PAGE_GET_ROUTES: readonly NonPageRouteAllowance[] = [
  { route: "/api/committed-work", reason: "JSON API returning principal-scoped live committed work" },
  { route: "/api/state", reason: "JSON API returning current thread state snapshot" },
  { route: "/payments/offers/:id/continue", reason: "Card checkout continuation redirect endpoint (no HTML screen)" },
  { route: "/payments/paystack/callback", reason: "Paystack verification callback redirect endpoint" },
  { route: "/payments/local/checkout", reason: "Deterministic local demo PSP simulation page (non-production only)" },
  { route: "/client.js", reason: "Static client JavaScript bundle" },
  { route: "/gallery.js", reason: "Static listing gallery enhancement script" },
  { route: "/payment.js", reason: "Static payment countdown enhancement script" },
  { route: "/offer.js", reason: "Static offer countdown enhancement script" },
  { route: "/shortlet-foundations.css", reason: "Static design-system stylesheet" },
  { route: "/shortlet-landing.css", reason: "Static landing page stylesheet" },
  { route: "/landing.js", reason: "Static landing page enhancement script" },
  { route: "/landing/fonts/*", reason: "Static self-hosted landing font assets" },
  { route: "/landing/photos/*", reason: "Static approved landing photo assets" },
  { route: "/xenia-partners.css", reason: "Static founding partners page stylesheet" },
  { route: "/partners.js", reason: "Static founding partners page enhancement script" },
];

const N1_HELP_GAP: NavGap = { rule: "N1", issue: "16", reason: "Help route /help and Help link in app bar are not built yet" };
const N3_PLANS_GAP: NavGap = { rule: "N3", issue: "11", reason: "Guest list route /plans and navigation links to it are not built yet" };
const N4_TAB_BAR_GAP: NavGap = { rule: "N4", issue: "15", reason: "Section tab bar is not built yet" };
const N5_TASK_CHROME_GAP: NavGap = { rule: "N5", issue: "15", reason: "Task screen uses h2 or lacks single Close task header" };

/**
 * Single source of truth for guest screens: route pattern, kind (section, task, state), expected non-Back exits,
 * planned flag (future screens not yet implemented), and recorded N1-N11 gaps with closing issue numbers.
 */
export const GUEST_NAVIGATION_TABLE: readonly GuestNavigationRow[] = [
  {
    id: "welcome",
    route: "/welcome",
    kind: "state",
    expectedExits: ["/", "/partners"],
    gaps: [N1_HELP_GAP, N3_PLANS_GAP],
  },
  {
    id: "partners",
    route: "/partners",
    kind: "state",
    expectedExits: ["/welcome"],
    gaps: [N1_HELP_GAP, N3_PLANS_GAP],
  },
  {
    id: "partners-applied",
    route: "/partners/applied",
    kind: "state",
    expectedExits: ["/partners", "/welcome"],
    gaps: [N1_HELP_GAP, N3_PLANS_GAP],
  },
  {
    id: "home-chat",
    route: "/",
    kind: "section",
    expectedExits: ["/plans", "/account"],
    gaps: [N1_HELP_GAP],
  },
  {
    id: "conversation",
    route: "/conversation",
    kind: "section",
    expectedExits: ["/", "/plans", "/account"],
    gaps: [N1_HELP_GAP],
  },
  {
    id: "stays-search",
    route: "/stays/search",
    kind: "section",
    expectedExits: ["/", "/plans", "/account"],
    gaps: [N1_HELP_GAP],
  },
  {
    id: "stay-detail",
    route: "/stays/:unitId",
    kind: "state",
    expectedExits: ["/", "/plans", "/account"],
    gaps: [N1_HELP_GAP],
  },
  {
    id: "booking-draft",
    route: "/booking-requests/drafts/:id",
    kind: "task",
    expectedExits: ["/"],
    gaps: [N1_HELP_GAP, N3_PLANS_GAP],
  },
  {
    id: "booking-request",
    route: "/booking-requests/:id",
    kind: "state",
    expectedExits: ["/", "/plans", "/account"],
    gaps: [N1_HELP_GAP],
  },
  {
    id: "conditional-offer",
    route: "/conditional-offers/:id",
    kind: "task",
    expectedExits: ["/"],
    gaps: [N1_HELP_GAP, N3_PLANS_GAP],
  },
  {
    id: "payment-choice",
    route: "/payments/offers/:id",
    kind: "task",
    expectedExits: ["/"],
    gaps: [N1_HELP_GAP, N3_PLANS_GAP],
  },
  {
    id: "bank-transfer",
    route: "/payments/offers/:id/transfer",
    kind: "task",
    expectedExits: ["/"],
    gaps: [N1_HELP_GAP, N3_PLANS_GAP],
  },
  {
    id: "manual-transfer",
    route: "/payments/offers/:id/manual-transfer",
    kind: "task",
    expectedExits: ["/"],
    gaps: [N1_HELP_GAP, N3_PLANS_GAP],
  },
  {
    id: "booking-contract",
    route: "/booking-contracts/:id",
    kind: "state",
    expectedExits: ["/", "/plans", "/account"],
    gaps: [N1_HELP_GAP],
  },
  {
    id: "booking-periods",
    route: "/bookings/periods/:offerId",
    kind: "state",
    expectedExits: ["/", "/plans", "/account"],
    gaps: [N1_HELP_GAP],
  },
  {
    id: "booking-notice",
    route: "/bookings/notice/:offerId",
    kind: "task",
    expectedExits: ["/bookings/periods/:offerId"],
    gaps: [N1_HELP_GAP, N3_PLANS_GAP],
  },
  {
    id: "guest-contact",
    route: "/guest/contact",
    kind: "task",
    expectedExits: ["/"],
    gaps: [N1_HELP_GAP, N3_PLANS_GAP],
  },
  {
    id: "account-sign-in",
    route: "/account/sign-in",
    kind: "task",
    expectedExits: ["/"],
    gaps: [N1_HELP_GAP, N3_PLANS_GAP],
  },
  {
    id: "account",
    route: "/account",
    kind: "section",
    expectedExits: ["/", "/plans"],
    gaps: [N1_HELP_GAP],
  },
  {
    id: "plans",
    route: "/plans",
    kind: "section",
    expectedExits: ["/", "/account"],
    gaps: [N1_HELP_GAP],
  },
  {
    id: "planned-help",
    route: "/help",
    kind: "section",
    expectedExits: ["/", "/plans"],
    planned: { issue: "16", note: "Contextual Help and support contact screen" },
    gaps: [],
  },
  {
    id: "planned-plan-detail",
    route: "/plans/:id",
    kind: "state",
    expectedExits: ["/plans", "/help"],
    planned: { issue: "17", note: "Stage-aware stay page" },
    gaps: [],
  },
  {
    id: "planned-plan-cancel",
    route: "/plans/:id/cancel",
    kind: "task",
    expectedExits: ["/plans/:id"],
    planned: { issue: "18", note: "Self-service cancellation and refund preview" },
    gaps: [],
  },
  {
    id: "planned-plan-change",
    route: "/plans/:id/change",
    kind: "task",
    expectedExits: ["/plans/:id"],
    planned: { issue: "19", note: "Unified change or cancel entry screen" },
    gaps: [],
  },
  {
    id: "planned-plan-report",
    route: "/plans/:id/report",
    kind: "task",
    expectedExits: ["/plans/:id"],
    planned: { issue: "20", note: "Mid-stay problem report intake and thread" },
    gaps: [],
  },
];

/** All served routes (live GET pages + non-page GET endpoints + POST form targets + static assets) for AC3 checks. */
const SERVED_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/$/,
  /^\/welcome$/,
  /^\/welcome\/start$/,
  /^\/welcome\/theme$/,
  /^\/partners$/,
  /^\/partners\/applied$/,
  /^\/partners\/apply$/,
  /^\/xenia-partners\.css$/,
  /^\/partners\.js$/,
  /^\/conversation$/,
  /^\/stays\/search$/,
  /^\/stays\/[^/]+$/,
  /^\/booking-requests\/drafts\/[^/]+$/,
  /^\/booking-requests\/drafts\/[^/]+\/(?:edit|review|submit)$/,
  /^\/booking-requests\/(?!drafts\/)[^/]+$/,
  /^\/booking-requests\/(?!drafts\/)[^/]+\/(?:conversation|search)$/,
  /^\/conditional-offers\/[^/]+$/,
  /^\/conditional-offers\/[^/]+\/(?:accept|conversation|search)$/,
  /^\/payments\/offers\/[^/]+$/,
  /^\/payments\/offers\/[^/]+\/(?:continue|transfer|manual-transfer|manual-transfer\/receipt)$/,
  /^\/payments\/local\/(?:transfer\/complete|checkout|complete)$/,
  /^\/payments\/periods\/[^/]+\/\d+$/,
  /^\/payments\/paystack\/callback$/,
  /^\/booking-contracts\/[^/]+$/,
  /^\/bookings\/periods\/[^/]+$/,
  /^\/bookings\/notice\/[^/]+$/,
  /^\/guest\/contact$/,
  /^\/guest\/contact\/(?:phone|email)$/,
  /^\/account$/,
  /^\/plans$/,
  /^\/account\/(?:sign-in|sign-in\/code|email|email\/code|phone|sign-out|sign-out-everywhere)$/,
  /^\/api\/(?:committed-work|state|turn|event|telemetry|reset)$/,
  /^\/(?:client|gallery|payment|offer|landing)\.js$/,
  /^\/shortlet-(?:foundations|landing)\.css$/,
  /^\/landing\/(?:fonts|photos)\/.+$/,
];

export interface RouteInventoryReport {
  readonly missingFromTable: readonly string[];
  readonly staleInTable: readonly string[];
  readonly staleAllowList: readonly string[];
}

/**
 * Extracts normalized GET routes from guest-server.ts and landing-route-module.ts sources.
 * Normalizes dynamic parameter segments so static source checks catch any new route added to the server.
 */
export function discoverGuestGetRoutes(sources: {
  readonly guestServer: string;
  readonly landingModule: string;
  readonly partnersModule?: string;
}): string[] {
  const routes = new Set<string>();
  const { guestServer, landingModule, partnersModule = "" } = sources;

  // 1. Static asset declarations in SHORTLET_STATIC_ASSETS
  for (const match of guestServer.matchAll(/path:\s*"(\/[^"]*)"/g)) {
    routes.add(match[1]!);
  }
  // 2. Direct GET pathname checks in guest-server.ts
  for (const match of guestServer.matchAll(/(?:req\.method === "GET"|method === "GET"|req\.method === "POST" \|\| req\.method === "GET"|\(req\.method === "GET" \|\| req\.method === "POST"\))[^;{]*?(?:url\.pathname|path) === "(\/[^"]*)"/gs)) {
    routes.add(match[1]!);
  }
  for (const match of guestServer.matchAll(/(?:url\.pathname|path) === "(\/[^"]*)"[^;{]*?(?:req\.method === "GET"|\(req\.method === "GET" \|\| req\.method === "POST"\)|req\.method === "POST" \|\| req\.method === "GET")/gs)) {
    routes.add(match[1]!);
  }
  // Handle /guest/contact GET branch specifically (multi-line OR condition before req.method === "GET")
  if (/url\.pathname === "\/guest\/contact"/.test(guestServer) && /req\.method === "GET" && url\.pathname === "\/guest\/contact"/.test(guestServer)) {
    routes.add("/guest/contact");
  }
  // Handle /payments/offers/:id GET branch (the regex matcher serves both POST and GET)
  if (/\/\^\\\/payments\\\/offers\\\/\(\[\^\/\]\+\)\$\//.test(guestServer)) {
    routes.add("/payments/offers/:id");
  }
  if (/\/\^\\\/payments\\\/offers\\\/\(\[\^\/\]\+\)\\\/transfer\$\//.test(guestServer)) {
    routes.add("/payments/offers/:id/transfer");
  }
  if (/\/\^\\\/payments\\\/offers\\\/\(\[\^\/\]\+\)\\\/manual-transfer\(\\\/receipt\)\?\$\//.test(guestServer)) {
    routes.add("/payments/offers/:id/manual-transfer");
  }
  if (/\/\^\\\/payments\\\/offers\\\/\(\[\^\/\]\+\)\\\/continue\$\//.test(guestServer)) {
    routes.add("/payments/offers/:id/continue");
  }
  if (/\/\^\\\/stays\\\/\(\[\^\/\]\+\)\$\//.test(guestServer)) {
    routes.add("/stays/:unitId");
  }
  if (/\/\^\\\/bookings\\\/periods\\\/\(\[\^\/\]\+\)\$\//.test(guestServer)) {
    routes.add("/bookings/periods/:offerId");
  }
  if (/\/\^\\\/bookings\\\/notice\\\/\(\[\^\/\]\+\)\$\//.test(guestServer)) {
    routes.add("/bookings/notice/:offerId");
  }
  // Booking route tuple entries (drafts, requests, offers, contracts)
  if (/\["draft",\s*\/\^\\\/booking-requests\\\/drafts\\\/\(\[\^\/\]\+\)\$\/\]/.test(guestServer)) {
    routes.add("/booking-requests/drafts/:id");
  }
  if (/\["request",\s*\/\^\\\/booking-requests\\\/\(\[\^\/\]\+\)\$\/\]/.test(guestServer)) {
    routes.add("/booking-requests/:id");
  }
  if (/\["offer",\s*\/\^\\\/conditional-offers\\\/\(\[\^\/\]\+\)\$\/\]/.test(guestServer)) {
    routes.add("/conditional-offers/:id");
  }
  if (/\["contract",\s*\/\^\\\/booking-contracts\\\/\(\[\^\/\]\+\)\$\/\]/.test(guestServer)) {
    routes.add("/booking-contracts/:id");
  }
  // Generic fallback for any literal `req.method === "GET" && (url.pathname|path) === "/..."`
  for (const match of guestServer.matchAll(/req\.method === "GET"\s*&&\s*(?:url\.pathname|path) === "(\/[^"]*)"/g)) {
    routes.add(match[1]!);
  }
  // Landing route module GET routes
  for (const match of landingModule.matchAll(/req\.method === "GET"\s*&&[\s\S]{0,120}?(?:url\.pathname === "(\/[^"]+)"|url\.pathname\.startsWith\("(\/[^"]+)"\))/g)) {
    if (match[1]) routes.add(match[1]);
    if (match[2]) routes.add(`${match[2]}*`);
  }
  for (const match of landingModule.matchAll(/url\.pathname === "(\/shortlet-landing\.css|\/landing\.js)"/g)) {
    routes.add(match[1]!);
  }
  if (landingModule.includes('url.pathname.startsWith("/landing/fonts/")')) routes.add("/landing/fonts/*");
  if (landingModule.includes('url.pathname.startsWith("/landing/photos/")')) routes.add("/landing/photos/*");
  // Partners route module GET routes (landing issue 17)
  for (const match of partnersModule.matchAll(/req\.method === "GET"\s*&&[\s\S]{0,80}?url\.pathname === "(\/[^"]+)"/g)) {
    routes.add(match[1]!);
  }
  for (const match of partnersModule.matchAll(/url\.pathname === "(\/xenia-partners\.css|\/partners\.js)"/g)) {
    routes.add(match[1]!);
  }

  return [...routes].sort();
}

export function compareRouteInventory(
  discovered: readonly string[],
  table: readonly GuestNavigationRow[],
  allowList: readonly NonPageRouteAllowance[],
): RouteInventoryReport {
  const liveTableRoutes = new Set(table.filter((row) => row.planned === undefined).map((row) => row.route));
  const allowed = new Set(allowList.map((entry) => entry.route));
  const discoveredSet = new Set(discovered);
  return {
    missingFromTable: discovered.filter((route) => !liveTableRoutes.has(route) && !allowed.has(route)).sort(),
    staleInTable: [...liveTableRoutes].filter((route) => !discoveredSet.has(route)).sort(),
    staleAllowList: [...allowed].filter((route) => !discoveredSet.has(route)).sort(),
  };
}

export interface InternalTargets {
  readonly links: readonly string[];
  readonly forms: readonly string[];
}

function decodeHtmlAttr(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

function normalizeInternalTarget(raw: string): string | null {
  const decoded = decodeHtmlAttr(raw);
  if (decoded === "" || decoded.startsWith("#")) return null;
  if (/^(?:https?:|mailto:|tel:|javascript:|data:)/i.test(decoded)) return null;
  const withoutHash = decoded.split("#")[0]!;
  const pathname = withoutHash.split("?")[0]!;
  return pathname.startsWith("/") ? pathname : null;
}

export function extractInternalTargets(html: string): InternalTargets {
  const links: string[] = [];
  const forms: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref=(?:"([^"]*)"|'([^']*)')/gi)) {
    const raw = match[1] ?? match[2] ?? "";
    const target = normalizeInternalTarget(raw);
    if (target !== null) links.push(target);
  }
  for (const match of html.matchAll(/<form\b[^>]*\baction=(?:"([^"]*)"|'([^']*)')/gi)) {
    const raw = match[1] ?? match[2] ?? "";
    const target = normalizeInternalTarget(raw);
    if (target !== null) forms.push(target);
  }
  return { links, forms };
}

export function isServedGuestRoute(pathname: string): boolean {
  return SERVED_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function findUnservedTargets(html: string): readonly string[] {
  const targets = extractInternalTargets(html);
  const all = [...targets.links, ...targets.forms];
  return [...new Set(all.filter((target) => !isServedGuestRoute(target)))].sort();
}

export interface PageCheckResult {
  readonly id: string;
  readonly route: string;
  readonly exitLinks: readonly string[];
  readonly missingExpectedExits: readonly string[];
  readonly unservedTargets: readonly string[];
  readonly failedRules: readonly NavRuleId[];
  readonly unrecordedFailures: readonly NavRuleId[];
  readonly staleGaps: readonly NavRuleId[];
}

function matchesExpectedExit(target: string, pattern: string): boolean {
  if (pattern === target) return true;
  if (pattern.includes(":")) {
    const regex = new RegExp(`^${pattern.replace(/:[^/]+/g, "[^/]+")}$`);
    return regex.test(target);
  }
  return false;
}

export function evaluatePageNavigation(row: GuestNavigationRow, renderedPath: string, html: string): PageCheckResult {
  const renderedPathname = renderedPath.split("?")[0]!;
  const targets = extractInternalTargets(html);
  // N2: an exit that is not the browser's Back — a non-self navigation link `<a href>` (or link to a different route).
  const exitLinks = [...new Set(targets.links.filter((link) => link !== renderedPathname || link === "/"))].filter(
    (link) => link !== renderedPathname || (renderedPathname === "/" && targets.links.some((other) => other !== "/")),
  );
  // Specifically: links to another route, or if on `/`, links to another route such as `/guest/contact`.
  const otherRouteLinks = [...new Set(targets.links.filter((link) => link !== renderedPathname))];
  const unservedTargets = findUnservedTargets(html);

  const failedRules: NavRuleId[] = [];
  // N1: Help link
  if (!targets.links.some((link) => link === "/help")) failedRules.push("N1");
  // N2: Non-Back navigation exit
  if (otherRouteLinks.length === 0) failedRules.push("N2");
  // N3: List (/plans) and Find (/ or /stays/search) reachable
  const canReachPlans = renderedPathname === "/plans" || targets.links.includes("/plans");
  const canReachFind = renderedPathname === "/" || renderedPathname === "/stays/search" || targets.links.includes("/") || targets.links.includes("/stays/search");
  if (!canReachPlans || !canReachFind) failedRules.push("N3");
  // N4: Tab bar shows on in-app section pages and never on task screens
  const hasTabBar = /class="[^"]*\bui-tabbar\b|role="tablist"/i.test(html);
  if (row.kind === "section" && !hasTabBar) failedRules.push("N4");
  if (row.kind === "task" && hasTabBar) failedRules.push("N4");
  // N5: Task screen has one h1 title, one close/exit, and one primary action
  if (row.kind === "task") {
    const h1Count = (html.match(/<h1\b/gi) ?? []).length;
    const hasPrimary = /type="submit"|class="[^"]*ui-button--primary/i.test(html);
    if (h1Count !== 1 || !hasPrimary) failedRules.push("N5");
  }
  // N7: Single registered domain -> no chooser, no domain tag, no other domain's concierge name
  if (
    /Change concierge/i.test(html) ||
    /\bui-domain-tag\b/.test(html) ||
    /Concierge\s*[·•]\s*(?:Events|Services|Community|Shop)\b/i.test(html)
  ) {
    failedRules.push("N7");
  }
  // N11: Any rendered task/notification badge carries screen-reader text
  for (const badgeMatch of html.matchAll(/class="[^"]*\bui-task-badge\b[^"]*"[^>]*>(.*?)<\/span>/gis)) {
    if (!/\b(?:ui-sr-only|sr-only)\b/.test(badgeMatch[1]!)) {
      failedRules.push("N11");
      break;
    }
  }

  const recorded = new Set(row.gaps.map((gap) => gap.rule));
  const failed = new Set(failedRules);
  const unrecordedFailures = failedRules.filter((rule) => !recorded.has(rule));
  const staleGaps = row.gaps.map((gap) => gap.rule).filter((rule) => !failed.has(rule));
  const missingExpectedExits = recorded.has("N2")
    ? []
    : row.expectedExits.filter((expected) => !targets.links.some((link) => matchesExpectedExit(link, expected)));

  return {
    id: row.id,
    route: row.route,
    exitLinks: otherRouteLinks.length > 0 ? otherRouteLinks : exitLinks,
    missingExpectedExits,
    unservedTargets,
    failedRules,
    unrecordedFailures,
    staleGaps,
  };
}

interface RenderedLiveRoute {
  readonly row: GuestNavigationRow;
  readonly path: string;
  readonly html: string;
}

let cachedLiveRoutesPromise: Promise<RenderedLiveRoute[]> | null = null;

function renderAllLiveGuestRoutes(): Promise<RenderedLiveRoute[]> {
  cachedLiveRoutesPromise ??= renderAllLiveGuestRoutesUncached();
  return cachedLiveRoutesPromise;
}

/**
 * Renders every live (non-planned) row in GUEST_NAVIGATION_TABLE through the real handlers
 * (`sendGuest` via guest-route-harness.ts and `withStagePage` via guest-stage-pages.ts).
 */
async function renderAllLiveGuestRoutesUncached(): Promise<RenderedLiveRoute[]> {
  const rendered: RenderedLiveRoute[] = [];
  const dir = mkdtempSync(join(tmpdir(), "guest-nav-"));
  const sender = new CapturingEmailSender();
  const env = LocalGuestEnvironment.openNode({
    databasePath: join(dir, "guest.sqlite"),
    manualTransferAccount: TEST_MANUAL_ACCOUNT,
    initialGuestPhoneNumber: null,
    initialGuestContactEmail: null,
    clock: () => new Date("2026-10-27T10:00:00.000Z"),
  });
  // Extend the first unit so Extended Stay routes (/bookings/periods/:offerId, /bookings/notice/:offerId) render too.
  const firstUnit = env.unitRepository.findAll()[0]!;
  env.unitRepository.save(extendUnit(firstUnit, {}));

  try {
    const handler = createGuestRequestHandler({
      environment: env,
      commerceModule: LOCAL_COMMERCE_MODULE,
      localPayment: true,
      sessionScopedGuestPrincipals: true,
      guestAccounts: accountComposition({ sender, databasePath: env.config.databasePath }),
    });

    // 1. Landing & shell & search & detail & contact & account routes via sendGuest
    const welcome = await sendGuest(handler, "GET", "/welcome");
    assert.equal(welcome.statusCode, 200);
    rendered.push({ row: rowById("welcome"), path: "/welcome", html: welcome.bodyText });

    const partners = await sendGuest(handler, "GET", "/partners");
    assert.equal(partners.statusCode, 200);
    rendered.push({ row: rowById("partners"), path: "/partners", html: partners.bodyText });

    const partnersApplied = await sendGuest(handler, "GET", "/partners/applied");
    assert.equal(partnersApplied.statusCode, 200);
    rendered.push({ row: rowById("partners-applied"), path: "/partners/applied", html: partnersApplied.bodyText });

    const home = await sendGuest(handler, "GET", "/");
    assert.equal(home.statusCode, 200);
    const cookie = cookieOf(home);
    rendered.push({ row: rowById("home-chat"), path: "/", html: home.bodyText });

    const plans = await sendGuest(handler, "GET", "/plans", { cookie });
    assert.equal(plans.statusCode, 200);
    rendered.push({ row: rowById("plans"), path: "/plans", html: plans.bodyText });

    const convInit = await sendGuest(handler, "GET", "/conversation", { cookie });
    assert.equal(convInit.statusCode, 303);
    const convPath = convInit.headers.find((h) => h.name.toLowerCase() === "location")!.value;
    const conv = await sendGuest(handler, "GET", convPath, { cookie });
    assert.equal(conv.statusCode, 200);
    rendered.push({ row: rowById("conversation"), path: convPath, html: conv.bodyText });

    const search = await sendGuest(handler, "GET", "/stays/search?area=old-ikoyi&checkIn=2026-10-28&checkOut=2026-10-31&partySize=2");
    assert.equal(search.statusCode, 200);
    rendered.push({ row: rowById("stays-search"), path: "/stays/search", html: search.bodyText });

    const unitPath = `/stays/${encodeURIComponent(firstUnit.id)}`;
    const unit = await sendGuest(handler, "GET", unitPath);
    assert.equal(unit.statusCode, 200);
    rendered.push({ row: rowById("stay-detail"), path: unitPath, html: unit.bodyText });

    const contact = await sendGuest(handler, "GET", "/guest/contact", { cookie });
    assert.equal(contact.statusCode, 200);
    rendered.push({ row: rowById("guest-contact"), path: "/guest/contact", html: contact.bodyText });

    const signIn = await sendGuest(handler, "GET", "/account/sign-in", { cookie });
    assert.equal(signIn.statusCode, 200);
    rendered.push({ row: rowById("account-sign-in"), path: "/account/sign-in", html: signIn.bodyText });

    // Sign in to render /account
    const codePost = await sendGuest(handler, "POST", "/account/sign-in", { cookie, form: { email: "ada@example.test", return: "/account" } });
    assert.equal(codePost.statusCode, 200);
    const challengeMatch = /name="challengeId" value="([^"]+)"/.exec(codePost.bodyText);
    assert.ok(challengeMatch, "challengeId rendered");
    const verify = await sendGuest(handler, "POST", "/account/sign-in/code", {
      cookie,
      form: { email: "ada@example.test", challengeId: challengeMatch[1]!, code: sender.codeFor("ada@example.test"), return: "/account" },
    });
    assert.equal(verify.statusCode, 303);
    const setCookies = verify.headers
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value.split(";")[0]!);
    const rotatedSessionPair = setCookies.find((pair) => pair.startsWith("shortlet_guest_session="));
    const accountCookiePair = setCookies.find((pair) => pair.startsWith("shortlet_guest_account="));
    assert.ok(accountCookiePair, "account cookie issued");
    const account = await sendGuest(handler, "GET", "/account", { cookie: `${rotatedSessionPair ?? cookie}; ${accountCookiePair}` });
    assert.equal(account.statusCode, 200);
    rendered.push({ row: rowById("account"), path: "/account", html: account.bodyText });
  } finally {
    env.close();
    rmSync(dir, { recursive: true, force: true });
  }

  // 3. Booking stage pages via withStagePage (guest-stage-pages.ts)
  const stageRowMap: Record<string, string> = {
    "Request review": "booking-draft",
    "Request sent": "booking-request",
    "Conditional Booking Offer": "conditional-offer",
    "Payment choice": "payment-choice",
    "Provider bank transfer": "bank-transfer",
    "Manual bank transfer": "manual-transfer",
    "Reservation confirmed": "booking-contract",
  };
  for (const spec of BOOKING_STAGE_PAGES) {
    const rowId = stageRowMap[spec.label];
    if (!rowId) continue;
    await withStagePage(spec, async ({ fixture, path }) => {
      const response = await fetch(`${fixture.base}${path}`, { headers: { cookie: fixture.cookie, accept: "text/html" } });
      assert.equal(response.status, 200, `${spec.label} (${path})`);
      rendered.push({ row: rowById(rowId), path, html: await response.text() });
    });
  }

  // 4. Extended stay period schedule & notice pages via real server handler
  await withExtendedStayServer(async ({ base, cookie, offerId }) => {
    for (const [rowId, path] of [
      ["booking-periods", `/bookings/periods/${encodeURIComponent(offerId)}`],
      ["booking-notice", `/bookings/notice/${encodeURIComponent(offerId)}`],
    ] as const) {
      const response = await fetch(`${base}${path}`, { headers: { cookie, accept: "text/html" } });
      assert.equal(response.status, 200, `${rowId} (${path})`);
      rendered.push({ row: rowById(rowId), path, html: await response.text() });
    }
  });

  return rendered;
}

async function withExtendedStayServer<T>(run: (ctx: { base: string; cookie: string; offerId: string }) => Promise<T>): Promise<T> {
  const { restartFixture } = await import("./helpers/guest-restart.js");
  const fixture = await restartFixture({ manualTransferAccount: TEST_MANUAL_ACCOUNT }, { localPayment: true });
  try {
    const seeded = fixture.environment.unitRepository.findAll()[0]!;
    fixture.environment.unitRepository.save(extendUnit(seeded, {}));
    const discovery = await fixture.send("/api/turn", { text: "I need an apartment in Ikoyi from 10 Sept for 31 nights for 2 people" });
    assert.equal(discovery.ok, true);
    let result: GuestTurnSuccess = discovery;
    const routes = new Map<string, string>();
    const collect = (surfaces: readonly { readonly conventionalRoute?: string }[]) => {
      for (const s of surfaces) {
        if (s.conventionalRoute) routes.set(s.conventionalRoute.split("/")[1]!, s.conventionalRoute);
      }
    };
    collect(result.surfaces);
    // Advance through inspection -> draft -> review -> pending -> offer -> payment-ready -> handoff -> confirmed
    const steps = ["inspection", "draft", "review", "pending", "offer", "payment-ready", "handoff", "confirmed"] as const;
    for (const stage of steps) {
      if (stage === "offer") {
        const requestId = result.surfaces[0]!.surfaceId.split(":").at(-1)!;
        fixture.environment.simulateOperatorAcceptance(requestId);
        const current = await fixture.state();
        assert.equal(current.ok, true);
        result = { ok: true, messages: [], surfaces: current.surfaces };
      } else {
        const action = guestAction(result.surfaces[0]!);
        const next = await fixture.send("/api/event", action);
        assert.equal(next.ok, true);
        result = next;
      }
      collect(result.surfaces);
    }
    const offerRoute = routes.get("conditional-offers");
    assert.ok(offerRoute, "extended stay offer route");
    const offerId = /^\/conditional-offers\/([^/?]+)/.exec(offerRoute)![1]!;
    const contract = fixture.environment.cardPaymentApp.getBookingContract(offerId);
    assert.ok(contract, "extended stay contract");
    // Record verified access so Notice to End page renders 200
    const db = openNodeSqliteDatabase(fixture.databasePath);
    try {
      new SqliteCheckInSupportStore(db).save(contract.reservationId, {
        schedule: null,
        window: null,
        evidence: [],
        result: {
          reservationId: contract.reservationId,
          status: "verified_access",
          verifiedAt: "2026-09-10T10:00:00.000Z",
          protectionWindowStartsAt: "2026-09-10T10:00:00.000Z",
        },
        complaints: [],
      });
    } finally {
      db.close();
    }
    return await run({ base: fixture.base, cookie: fixture.cookie, offerId });
  } finally {
    await fixture.close();
  }
}

function rowById(id: string): GuestNavigationRow {
  const row = GUEST_NAVIGATION_TABLE.find((entry) => entry.id === id);
  assert.ok(row, `Unknown navigation row id: ${id}`);
  return row;
}

// ----------------------------------------------------------------------------------------------------------------------
// Acceptance criteria tests (1 dedicated test() per criterion)
// ----------------------------------------------------------------------------------------------------------------------

test("AC1: A guest route missing from the table fails the test", () => {
  // Failure path: an unlisted GET route discovered in guest-server.ts is flagged in missingFromTable.
  const synthetic = discoverGuestGetRoutes({
    guestServer: `${readFileSync(GUEST_SERVER_PATH, "utf8")}\nif (req.method === "GET" && url.pathname === "/unlisted-guest-screen") {}`,
    landingModule: readFileSync(LANDING_ROUTE_PATH, "utf8"),
    partnersModule: readFileSync(PARTNERS_ROUTE_PATH, "utf8"),
  });
  const syntheticReport = compareRouteInventory(synthetic, GUEST_NAVIGATION_TABLE, NON_PAGE_GET_ROUTES);
  assert.deepEqual(syntheticReport.missingFromTable, ["/unlisted-guest-screen"]);

  // Live check: every GET route in guest-server.ts, landing-route-module.ts, and partners-route-module.ts is accounted for.
  const live = discoverGuestGetRoutes({
    guestServer: readFileSync(GUEST_SERVER_PATH, "utf8"),
    landingModule: readFileSync(LANDING_ROUTE_PATH, "utf8"),
    partnersModule: readFileSync(PARTNERS_ROUTE_PATH, "utf8"),
  });
  const liveReport = compareRouteInventory(live, GUEST_NAVIGATION_TABLE, NON_PAGE_GET_ROUTES);
  assert.deepEqual(liveReport.missingFromTable, [], "every live GET guest route is in GUEST_NAVIGATION_TABLE or NON_PAGE_GET_ROUTES");
  assert.deepEqual(liveReport.staleInTable, [], "no live row in GUEST_NAVIGATION_TABLE is missing from server");
  assert.deepEqual(liveReport.staleAllowList, [], "no entry in NON_PAGE_GET_ROUTES is stale");
});

test("AC2: Every page has an exit that is not the browser's Back", async () => {
  // Failure path: a fixture page without any non-Back navigation exit fails and is reported by name.
  const trappedRow: GuestNavigationRow = {
    id: "trapped-fixture",
    route: "/trapped-fixture",
    kind: "state",
    expectedExits: ["/"],
    gaps: [],
  };
  const trapped = evaluatePageNavigation(trappedRow, "/trapped-fixture", "<html><body><main><h1>Trapped</h1></main></body></html>");
  assert.ok(trapped.unrecordedFailures.includes("N2"), `${trapped.id} reports N2 failure when it has no non-Back exit`);

  // Live check across all rendered guest pages.
  const pages = await renderAllLiveGuestRoutes();
  const liveRoutes = GUEST_NAVIGATION_TABLE.filter((row) => row.planned === undefined);
  assert.equal(pages.length, liveRoutes.length, "every live route in GUEST_NAVIGATION_TABLE was rendered");
  for (const page of pages) {
    const result = evaluatePageNavigation(page.row, page.path, page.html);
    assert.ok(!result.unrecordedFailures.includes("N2"), `${result.id} (${result.route}) must have a non-Back exit`);
    assert.deepEqual(result.missingExpectedExits, [], `${result.id} (${result.route}) must expose expected exits`);
  }
});

test("AC3: No internal link leads to a route the server does not serve", async () => {
  // Failure path: a fixture page containing an internal link to an unserved route reports that route.
  const brokenHtml = '<html><body><a href="/">Home</a><a href="/does-not-exist">Broken</a><form method="post" action="/unserved-post"></form></body></html>';
  assert.deepEqual(findUnservedTargets(brokenHtml), ["/does-not-exist", "/unserved-post"]);

  // Live check across all rendered guest pages.
  const pages = await renderAllLiveGuestRoutes();
  for (const page of pages) {
    const unserved = findUnservedTargets(page.html);
    assert.deepEqual(unserved, [], `${page.row.id} (${page.path}) has no internal links/forms to unserved routes`);
  }
});

test("AC4: Removing a recorded gap without fixing it fails; fixing it without removing the record also fails", async () => {
  // Failure path (a): removing a recorded gap while the page still fails the rule fails with unrecordedFailures.
  const rowWithoutN1Gap: GuestNavigationRow = {
    id: "missing-help-gap",
    route: "/account",
    kind: "section",
    expectedExits: ["/"],
    gaps: [N3_PLANS_GAP, N4_TAB_BAR_GAP],
  };
  const unrecorded = evaluatePageNavigation(rowWithoutN1Gap, "/account", '<html><body><a href="/">Home</a></body></html>');
  assert.ok(unrecorded.unrecordedFailures.includes("N1"), "removing N1 gap without adding /help fails");

  // Failure path (b): fixing the HTML so the rule passes while keeping the recorded gap fails with staleGaps.
  const rowWithStaleN1Gap: GuestNavigationRow = {
    id: "fixed-help-with-stale-gap",
    route: "/stays/unit-1",
    kind: "state",
    expectedExits: ["/"],
    gaps: [N1_HELP_GAP, N3_PLANS_GAP],
  };
  const stale = evaluatePageNavigation(rowWithStaleN1Gap, "/stays/unit-1", '<html><body><a href="/">Home</a><a href="/help">Help</a></body></html>');
  assert.ok(stale.staleGaps.includes("N1"), "fixing /help without removing N1 gap fails as stale");

  // Live ratchet across all rendered guest pages: zero unrecorded failures and zero stale gaps.
  const pages = await renderAllLiveGuestRoutes();
  for (const page of pages) {
    const result = evaluatePageNavigation(page.row, page.path, page.html);
    assert.deepEqual(result.unrecordedFailures, [], `${page.row.id} (${page.row.route}) has unrecorded navigation failures`);
    assert.deepEqual(result.staleGaps, [], `${page.row.id} (${page.row.route}) has stale recorded gaps that now pass`);
  }
});

test("Planned rows: screens that do not exist yet are recorded as planned rows, not failures", () => {
  const planned = GUEST_NAVIGATION_TABLE.filter((row) => row.planned !== undefined);
  assert.ok(planned.length >= 5, "planned future screens (/help, /plans/:id, cancel, change, report) are listed");
  for (const row of planned) {
    assert.ok(row.planned!.issue.length > 0, `${row.id} names its tracking issue`);
    assert.equal(isServedGuestRoute(row.route.replace(/:[^/]+/g, "sample-id")), false, `${row.route} is not yet served`);
  }
});
