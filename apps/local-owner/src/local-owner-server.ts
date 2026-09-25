import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import {
  LocalApartmentOwnerEnvironment,
  resetLocalOwnerFixture,
  DEFAULT_LOCAL_OWNER_CONFIG,
  type LocalOwnerStateOverview,
} from "./local-owner-environment.js";
import { escapeHtml, formatMoney, icon, pageShell, type StatusTone } from "../../web/src/ui-kit.js";
import { formatStayDates } from "../../web-agent/src/booking-presentation.js";

const OPERATOR_SESSION_COOKIE = "shortlet_operator_session";
const OPERATOR_SECRET_COOKIE = "shortlet_operator_secret";
const SHORTLET_FOUNDATION_CSS = readFileSync(new URL("../../web/src/shortlet-foundations.css", import.meta.url), "utf8");

function cookieValue(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie ?? "";
  const pair = raw.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

function operatorPrincipal(req: IncomingMessage, env: LocalApartmentOwnerEnvironment) {
  const sessionId = cookieValue(req, OPERATOR_SESSION_COOKIE);
  const secret = cookieValue(req, OPERATOR_SECRET_COOKIE);
  return env.sessionAuthority.resolveSession(sessionId, secret);
}

function operatorLoginHtml(error = ""): string {
  return pageShell({
    title: "Operator sign in",
    width: "narrow",
    body: `<header class="ui-page__header"><p class="ui-eyebrow">Shortlet Operator</p><h1>Operator sign in</h1><p>Enter the one-time access token provided by operations.</p></header>${error ? `<p class="ui-banner ui-banner--danger" role="alert">${icon("alert")}<span>${escapeHtml(error)}</span></p>` : ""}<form class="ui-panel" method="post" action="/operator/login"><div class="ui-field"><label class="ui-field__label" for="token">One-time access token</label><input id="token" name="token" autocomplete="one-time-code" required></div><button class="ui-button ui-button--primary ui-button--block" type="submit">Sign in</button></form>`,
  });
}

function logoutForm(): string {
  return `<form method="post" action="/operator/logout"><button class="ui-button ui-button--quiet" type="submit">Log out</button></form>`;
}

function operatorShellHtml(principal: { actorId: string; tenantId: string }): string {
  return pageShell({
    title: "Operator",
    body: `<header class="ui-page__header"><p class="ui-eyebrow">Shortlet Operator</p><h1>Operator workspace</h1><p>You are authenticated for this tenant. Operator actions remain subject to the active representative grant.</p></header><section class="ui-panel"><dl class="ui-facts"><dt>Actor reference</dt><dd>${escapeHtml(principal.actorId)}</dd><dt>Tenant reference</dt><dd>${escapeHtml(principal.tenantId)}</dd></dl><div class="ui-row"><a class="ui-button ui-button--primary" href="/operator/requests">${icon("inbox")}Open Booking Requests</a>${logoutForm()}</div></section>`,
  });
}

function formatWat(iso: string): string { return new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) + " WAT"; }

/** Operator-facing lifecycle labels. The raw domain status stays in data-status for tooling. */
function requestStatus(status: string): { readonly label: string; readonly tone: StatusTone } {
  if (status === "disclosed") return { label: "Awaiting your response", tone: "info" };
  if (status === "confirmed") return { label: "Request confirmed", tone: "success" };
  if (status === "declined") return { label: "Request declined", tone: "danger" };
  if (status === "expired") return { label: "Request expired", tone: "warning" };
  return { label: `Request ${status}`, tone: "neutral" };
}

function requestBadge(status: string): string {
  const { label, tone } = requestStatus(status);
  return `<span class="ui-status ui-status--${tone}" data-status="${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function guestParty(facts: { readonly occupantCount?: number; readonly occupants: readonly string[] }): string {
  const count = facts.occupantCount ?? facts.occupants.length;
  return `${count} ${count === 1 ? "occupant" : "occupants"}`;
}

function operatorInboxHtml(env: LocalApartmentOwnerEnvironment, principal: { actorId: string; tenantId: string }): string {
  const requests = env.listOperatorRequestArtifacts({ id: principal.actorId, role: "operator", tenantId: principal.tenantId });
  const awaiting = requests.filter((request) => request.facts.status === "disclosed").length;
  const rows = requests.map((request) => {
    const facts = request.facts;
    const who = facts.primaryGuestName ? `${escapeHtml(facts.primaryGuestName)} · ` : "";
    const place = escapeHtml(facts.unitTitle ?? facts.unitId);
    return `<li><a class="ui-list__row" href="/operator/requests/${encodeURIComponent(facts.requestId)}" aria-describedby="deadline-${escapeHtml(facts.requestId)}"><span class="ui-list__primary">${who}${place}</span><span class="ui-list__aside">${formatMoney(facts.quote?.allInStayTotalKobo ?? 0)}</span><span class="ui-list__secondary">${escapeHtml(formatStayDates(facts.checkIn, facts.checkOut))} · ${facts.nights} ${facts.nights === 1 ? "night" : "nights"} · ${guestParty(facts)}</span><span class="ui-list__status">${requestBadge(facts.status)}</span><span class="ui-list__secondary" id="deadline-${escapeHtml(facts.requestId)}">Respond by ${formatWat(facts.operatorResponseDeadlineAt)}</span></a></li>`;
  }).join("");
  const summary = requests.length === 0 ? "" : `<p>${awaiting === 0 ? "Nothing needs a response right now." : `${awaiting} ${awaiting === 1 ? "request needs" : "requests need"} your response.`}</p>`;
  const list = rows
    ? `<ul class="ui-list">${rows}</ul>`
    : `<section class="ui-panel ui-empty"><div class="ui-empty__art">${icon("inbox")}</div><h2>No Booking Requests yet</h2><p>No Booking Requests are visible to this representative. New requests appear here as soon as a Guest sends one.</p></section>`;
  return pageShell({
    title: "Operator requests",
    body: `<header class="ui-page__header"><div class="ui-row" style="justify-content:space-between"><p class="ui-eyebrow">Shortlet Operator</p>${logoutForm()}</div><h1>Booking Requests</h1>${summary}</header><h2 class="ui-sr-only">Requests</h2>${list}`,
  });
}

function operatorRequestHtml(env: LocalApartmentOwnerEnvironment, principal: { actorId: string; tenantId: string }, requestId: string, error = ""): string {
  const request = env.operatorRequestDetail(requestId, { id: principal.actorId, role: "operator", tenantId: principal.tenantId });
  const facts = request.facts;
  const actionable = request.actions.length > 0 && facts.status === "disclosed";
  const action = (kind: "confirm" | "decline") => `/operator/requests/${encodeURIComponent(requestId)}/${kind}`;
  // Declining is irreversible for the Guest, so it sits behind a disclosure that restates the consequence.
  const decisions = actionable
    ? `<section class="ui-panel" aria-labelledby="decision-heading"><h2 id="decision-heading">Your decision</h2><p>Confirming creates the existing Conditional Booking Offer for the Guest. Declining releases the request inventory.</p><form method="post" action="${action("confirm")}"><button class="ui-button ui-button--primary ui-button--block" type="submit">Confirm Booking Request</button></form><details class="ui-confirm"><summary>Decline this request…</summary><div class="ui-confirm__body"><p>The Guest will be told these dates are not available and the held inventory is released. This cannot be undone.</p><form method="post" action="${action("decline")}"><button class="ui-button ui-button--destructive ui-button--block" type="submit">Decline Booking Request</button></form></div></details></section>`
    : `<p class="ui-banner">${icon("info")}<span>This request is no longer actionable.</span></p>`;
  return pageShell({
    title: `Booking Request · ${facts.unitTitle ?? requestId}`,
    style: ".ui-panel h2{margin:0;font-size:var(--font-size-h3);line-height:var(--font-line-h3)}.ui-panel p{margin:0}",
    body: `<p><a class="ui-button ui-button--quiet" href="/operator/requests">${icon("arrow-left")}Back to requests</a></p><header class="ui-page__header"><p class="ui-eyebrow">Booking Request</p><h1>${escapeHtml(facts.unitTitle ?? facts.unitId)}</h1><div class="ui-row">${requestBadge(facts.status)}</div></header>${error ? `<p class="ui-banner ui-banner--danger" role="alert">${icon("alert")}<span>${escapeHtml(error)}</span></p>` : ""}<section class="ui-panel" aria-label="Request facts"><dl class="ui-facts"><dt>Request</dt><dd>${escapeHtml(facts.requestId)}</dd><dt>Unit</dt><dd>${escapeHtml(facts.unitId)}</dd><dt>Dates</dt><dd><time datetime="${escapeHtml(facts.checkIn)}">${escapeHtml(facts.checkIn)}</time> to <time datetime="${escapeHtml(facts.checkOut)}">${escapeHtml(facts.checkOut)}</time> (${facts.nights} nights)</dd><dt>Guest party</dt><dd>${guestParty(facts)}</dd><dt>All-In Stay Total</dt><dd class="ui-money-total">${formatMoney(facts.quote?.allInStayTotalKobo ?? 0)}</dd>${facts.quote?.refundableSecurityDepositKobo ? `<dt>Refundable Security Deposit</dt><dd>${formatMoney(facts.quote.refundableSecurityDepositKobo)}</dd>` : ""}<dt>Response deadline</dt><dd>${formatWat(facts.operatorResponseDeadlineAt)}</dd></dl></section>${decisions}`,
  });
}

function operatorRequestDetailHtml(env: LocalApartmentOwnerEnvironment, principal: { actorId: string; tenantId: string }, requestId: string, error = ""): string {
  const request = env.operatorRequestDetail(requestId, { id: principal.actorId, role: "operator", tenantId: principal.tenantId });
  const phone = request.facts.phoneNumber;
  const html = operatorRequestHtml(env, principal, requestId, error);
  if (!phone) return html;
  return html.replace("<dt>All-In Stay Total</dt>", `<dt>Phone number</dt><dd>${escapeHtml(phone)}</dd><dt>All-In Stay Total</dt>`);
}

const formatKobo = formatMoney;

export function renderOwnerDashboardHtml(overview: LocalOwnerStateOverview): string {
  const latestRequest = overview.pendingRequests[overview.pendingRequests.length - 1];

  return `<!DOCTYPE html>
<html lang="en-NG" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shortlet Marketplace — Local Apartment Owner Test Surface</title>
  <link rel="stylesheet" href="/shortlet-foundations.css">
  <style>
    :root {
      /* Developer-only surface: the shared dark roles from shortlet-foundations.css. */
      --bg: var(--color-canvas);
      --card-bg: var(--color-surface);
      --border: var(--color-border-subtle);
      --text: var(--color-text-secondary);
      --text-heading: var(--color-text);
      --text-muted: var(--color-text-muted);
      --accent: var(--color-action);
      --accent-hover: var(--color-action-hover);
      --danger: var(--color-danger);
      --warning: var(--color-warning);
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      margin: 0;
      padding: 24px;
      line-height: 1.5;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h1 {
      color: var(--text-heading);
      font-size: 24px;
      margin: 0 0 4px 0;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: var(--radius-control);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-success { background: var(--color-success-surface); color: var(--color-success); border: 1px solid var(--color-success-border); }
    .badge-warning { background: var(--color-warning-surface); color: var(--color-warning); border: 1px solid var(--color-warning-border); }
    .badge-info { background: var(--color-info-surface); color: var(--color-info); border: 1px solid var(--color-info-border); }
    .badge-danger { background: var(--color-danger-surface); color: var(--color-danger); border: 1px solid var(--color-danger-border); }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      padding: 20px;
    }
    .card h2 {
      color: var(--text-heading);
      font-size: 16px;
      margin-top: 0;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .meta-label { color: var(--text-muted); }
    .muted { color: var(--text-muted); font-size: var(--font-size-small); }
    .positive { color: var(--color-success); }
    .meta-value { color: var(--text-heading); font-weight: 500; }
    .mono { font-family: var(--font-mono); }
    
    .actions-panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      padding: 20px;
      margin-bottom: 24px;
    }
    .btn {
      display: inline-block;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 600;
      border-radius: var(--radius-control);
      cursor: pointer;
      border: none;
      text-decoration: none;
    }
    .btn-primary { background: var(--accent); color: var(--color-on-action); }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-danger { background: var(--color-danger-surface); color: var(--danger); border: 1px solid var(--color-danger-border); }
    .btn-danger:hover { background: var(--color-danger-border); }
    .btn-secondary { background: var(--color-surface-subtle); color: var(--text); border: 1px solid var(--color-border); }
    .btn-secondary:hover { background: var(--color-surface-elevated); }
    
    .btn-group {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }
    
    .request-box {
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
      padding: 16px;
      background: var(--bg);
      margin-top: 12px;
    }
    
    pre {
      background: var(--bg);
      padding: 12px;
      border-radius: var(--radius-control);
      border: 1px solid var(--border);
      font-family: var(--font-mono);
      font-size: 12px;
      overflow-x: auto;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Shortlet Apartment Owner Dashboard</h1>
        <div class="muted">Local Developer Simulation & Testing Experience (Local Owner Ready)</div>
      </div>
      <div>
        <span class="badge badge-success">Localhost Fixture Active</span>
      </div>
    </header>

    <div class="grid">
      <!-- Card 1: Operator & Representative Authority -->
      <div class="card">
        <h2>
          <span>Operator & Representative</span>
          <span class="badge ${overview.representative.isAuthorized ? 'badge-success' : 'badge-danger'}">
            ${overview.representative.isAuthorized ? 'Authorized' : 'Unauthorized'}
          </span>
        </h2>
        <div class="meta-row">
          <span class="meta-label">Operator Legal Entity:</span>
          <span class="meta-value">${overview.operator.name}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Operator ID:</span>
          <span class="meta-value mono">${overview.operator.id}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Representative Person:</span>
          <span class="meta-value">${overview.representative.name}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Actor ID:</span>
          <span class="meta-value mono">${overview.representative.actorId}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Verification Status:</span>
          <span class="meta-value">${overview.operator.verified ? 'CAC & ID Verified (Responsible Person)' : 'Pending'}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Grant ID:</span>
          <span class="meta-value mono">${overview.representative.grant?.grantId ?? 'No active grant'}</span>
        </div>
      </div>

      <!-- Card 2: Apartment Unit Profile -->
      <div class="card">
        <h2>
          <span>Apartment Status</span>
          <span class="badge ${overview.unit.published ? 'badge-success' : 'badge-warning'}">
            ${overview.unit.published ? 'Published & Eligible' : 'Draft'}
          </span>
        </h2>
        <div class="meta-row">
          <span class="meta-label">Title:</span>
          <span class="meta-value">${overview.unit.title}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Location:</span>
          <span class="meta-value">${overview.unit.neighbourhood}, ${overview.unit.city}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Occupancy Model:</span>
          <span class="meta-value">${overview.unit.occupancyModel} (Capacity: ${overview.unit.capacity})</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Nightly Rate:</span>
          <span class="meta-value">${formatKobo(overview.unit.nightlyKobo)} / night</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Security Deposit:</span>
          <span class="meta-value">${formatKobo(overview.unit.refundableSecurityDepositKobo)} (refundable)</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Physical Inspection:</span>
          <span class="meta-value">${overview.unit.inspectionStatus === 'passed' ? 'Passed (All 9 Safety Scopes)' : 'Pending'}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Management Authority:</span>
          <span class="meta-value">${overview.unit.authorityStatus === 'verified' ? 'Verified (8 Permissions)' : 'Pending'}</span>
        </div>
      </div>

      <!-- Card 3: Trust Tier & Settlement Projections -->
      <div class="card">
        <h2>
          <span>Settlement & Trust Tier</span>
          <span class="badge badge-info">Tier: ${overview.trustTier.tier}</span>
        </h2>
        <div class="meta-row">
          <span class="meta-label">Current Trust Tier:</span>
          <span class="meta-value" style="text-transform: capitalize;">${overview.trustTier.tier}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Enforcement Status:</span>
          <span class="meta-value">${overview.enforcement.operatorStatus} (Level: ${overview.enforcement.enforcementLevel})</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Commission Base (3 nights):</span>
          <span class="meta-value">${formatKobo(overview.payoutProjections.commissionBaseKobo)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Captured Commission Rate:</span>
          <span class="meta-value">${(overview.payoutProjections.commissionRate * 100).toFixed(0)}% (Preferred tier)</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Operator Net:</span>
          <span class="meta-value">${formatKobo(overview.payoutProjections.operatorNetKobo)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Ordinary Settlement (100%):</span>
          <span class="meta-value positive">${formatKobo(overview.payoutProjections.payableNowKobo)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Routine Reserve:</span>
          <span class="meta-value">${formatKobo(overview.payoutProjections.reserveTrancheKobo)} (0% for Preferred)</span>
        </div>
      </div>
    </div>

    <!-- Incoming Booking Request Simulation & Decision Section -->
    <div class="actions-panel">
      <h2>Incoming Booking Request Interaction</h2>
      ${
        latestRequest
          ? `
        <div class="request-box">
          <div class="meta-row">
            <span class="meta-label">Request ID:</span>
            <span class="meta-value mono">${latestRequest.facts.requestId}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Status:</span>
            <span class="meta-value">
              <span class="badge ${
                latestRequest.facts.status === 'confirmed'
                  ? 'badge-success'
                  : latestRequest.facts.status === 'declined'
                  ? 'badge-danger'
                  : 'badge-warning'
              }">${latestRequest.facts.status}</span>
            </span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Stay Dates:</span>
            <span class="meta-value">${latestRequest.facts.checkIn} to ${latestRequest.facts.checkOut} (${latestRequest.facts.nights} nights)</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">All-In Stay Total:</span>
            <span class="meta-value">${formatKobo(latestRequest.facts.quote?.allInStayTotalKobo ?? 0)}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Refundable Security Deposit:</span>
            <span class="meta-value">${formatKobo(latestRequest.facts.quote?.refundableSecurityDepositKobo ?? 0)}</span>
          </div>

          ${
            latestRequest.facts.status === 'disclosed' && latestRequest.actions.length > 0
              ? `
            <div class="btn-group">
              <form method="POST" action="/action/confirm" style="display:inline;">
                <input type="hidden" name="requestId" value="${latestRequest.facts.requestId}" />
                <button type="submit" class="btn btn-primary">Confirm Booking (Lock Availability)</button>
              </form>
              <form method="POST" action="/action/decline" style="display:inline;">
                <input type="hidden" name="requestId" value="${latestRequest.facts.requestId}" />
                <button type="submit" class="btn btn-danger">Decline Booking</button>
              </form>
            </div>
          `
              : `
            <div class="muted" style="margin-top: 12px;">
              Request finalized with status <strong>${latestRequest.facts.status}</strong>.
            </div>
          `
          }
        </div>
      `
          : `
        <p class="muted">No demo booking requests active. Click below to simulate a verified incoming guest request.</p>
        <form method="POST" action="/action/demo-request">
          <button type="submit" class="btn btn-secondary">Generate Demo Booking Request</button>
        </form>
      `
      }

      <div style="margin-top: 20px; border-top: 1px solid var(--border); padding-top: 16px; display: flex; gap: 12px;">
        <form method="POST" action="/action/demo-request">
          <button type="submit" class="btn btn-secondary">New Demo Request</button>
        </form>
        <form method="POST" action="/action/reset">
          <button type="submit" class="btn btn-danger">Reset Fixture</button>
        </form>
      </div>
    </div>

    <!-- API State Payload JSON -->
    <details>
      <summary class="muted" style="cursor: pointer; margin-bottom: 8px;">View Authoritative Local State JSON</summary>
      <pre>${JSON.stringify(overview, null, 2)}</pre>
    </details>
  </div>
</body>
</html>`;
}

export function startLocalOwnerServer(options: {
  port?: number;
  environment?: LocalApartmentOwnerEnvironment;
  secureCookie?: boolean;
  publicOrigin?: string;
  production?: boolean;
} = {}) {
  const port = options.port ?? 3000;
  let env = options.environment ?? new LocalApartmentOwnerEnvironment();
  const production = options.production === true;
  if (production && !options.publicOrigin) throw new Error("Production Operator server requires SHORTLET_PUBLIC_ORIGIN");
  const cookieFlags = `${(options.secureCookie ?? production) ? "; Secure" : ""}; HttpOnly; SameSite=Lax; Path=/operator`;
  const browserOriginAccepted = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    return origin === (options.publicOrigin ?? `http://${req.headers.host ?? "localhost"}`);
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/shortlet-foundations.css") {
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" });
      res.end(SHORTLET_FOUNDATION_CSS);
      return;
    }

    if (req.method === "GET" && url.pathname === "/operator/login") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(operatorLoginHtml()); return;
    }
    if (req.method === "POST" && url.pathname === "/operator/login") {
      if (!browserOriginAccepted(req)) { res.writeHead(403); res.end("Origin rejected"); return; }
      const buffers: Buffer[] = []; for await (const chunk of req) buffers.push(Buffer.from(chunk));
      const params = new URLSearchParams(Buffer.concat(buffers).toString("utf8"));
      try {
        const result = env.sessionAuthority.authenticateAccessToken(params.get("token") ?? "");
        res.setHeader("Set-Cookie", [`${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(result.sessionId)}${cookieFlags}`, `${OPERATOR_SECRET_COOKIE}=${encodeURIComponent(result.sessionSecret)}${cookieFlags}`]);
        res.writeHead(302, { Location: "/operator" }); res.end();
      } catch (error) { res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" }); res.end(operatorLoginHtml(error instanceof Error ? error.message : "Authentication failed")); }
      return;
    }
    if (url.pathname === "/operator" || url.pathname === "/operator/") {
      const principal = operatorPrincipal(req, env);
      if (!principal) { res.writeHead(401, { "Location": "/operator/login", "Content-Type": "text/plain" }); res.end("Authentication required"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(operatorShellHtml(principal)); return;
    }
    if (url.pathname === "/operator/requests" || url.pathname === "/operator/requests/") {
      const principal = operatorPrincipal(req, env);
      if (!principal) { res.writeHead(401); res.end("Authentication required"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(operatorInboxHtml(env, principal)); return;
    }
    const detailMatch = url.pathname.match(/^\/operator\/requests\/([^/]+)$/);
    if (req.method === "GET" && detailMatch) {
      const principal = operatorPrincipal(req, env);
      if (!principal) { res.writeHead(401); res.end("Authentication required"); return; }
      try { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(operatorRequestDetailHtml(env, principal, decodeURIComponent(detailMatch[1]))); }
      catch { res.writeHead(404); res.end("Request not found"); }
      return;
    }
    const actionMatch = url.pathname.match(/^\/operator\/requests\/([^/]+)\/(confirm|decline)$/);
    if (req.method === "POST" && actionMatch) {
      if (!browserOriginAccepted(req)) { res.writeHead(403); res.end("Origin rejected"); return; }
      const principal = operatorPrincipal(req, env);
      if (!principal) { res.writeHead(401); res.end("Authentication required"); return; }
      const requestId = decodeURIComponent(actionMatch[1]);
      try {
        if (actionMatch[2] === "confirm") env.confirmOperatorRequest(requestId, { id: principal.actorId, role: "operator", tenantId: principal.tenantId });
        else env.declineOperatorRequest(requestId, { id: principal.actorId, role: "operator", tenantId: principal.tenantId });
        res.writeHead(303, { Location: `/operator/requests/${encodeURIComponent(requestId)}` }); res.end();
      } catch (error) {
        let body = "Request action rejected";
        try { body = operatorRequestDetailHtml(env, principal, requestId, error instanceof Error ? error.message : "Request action rejected"); } catch { /* authorization may have changed; keep generic */ }
        if (!res.headersSent) { res.writeHead(409, { "Content-Type": body.startsWith("<!doctype") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" }); res.end(body); }
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/operator/logout") {
      if (!browserOriginAccepted(req)) { res.writeHead(403); res.end("Origin rejected"); return; }
      const principal = operatorPrincipal(req, env); if (principal) env.sessionAuthority.revokeSession(principal.sessionId);
      res.setHeader("Set-Cookie", [`${OPERATOR_SESSION_COOKIE}=; Max-Age=0${cookieFlags}`, `${OPERATOR_SECRET_COOKIE}=; Max-Age=0${cookieFlags}`]);
      res.writeHead(302, { Location: "/operator/login" }); res.end(); return;
    }

    if (!production && req.method === "GET" && url.pathname === "/") {
      const overview = env.getStateOverview();
      const html = renderOwnerDashboardHtml(overview);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (!production && req.method === "GET" && url.pathname === "/api/state") {
      const overview = env.getStateOverview();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(overview, null, 2));
      return;
    }

    if (!production && req.method === "POST") {
      const buffers: Buffer[] = [];
      for await (const chunk of req) {
        buffers.push(Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(buffers).toString("utf8");
      const params = new URLSearchParams(rawBody);

      if (url.pathname === "/action/demo-request") {
        env.createDemoIncomingBookingRequest();
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }

      if (url.pathname === "/action/confirm") {
        const requestId = params.get("requestId");
        if (requestId) {
          env.confirmBookingRequest(requestId);
        }
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }

      if (url.pathname === "/action/decline") {
        const requestId = params.get("requestId");
        if (requestId) {
          env.declineBookingRequest(requestId);
        }
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }

      if (url.pathname === "/action/reset") {
        env.close();
        resetLocalOwnerFixture(env.config.databasePath);
        env = new LocalApartmentOwnerEnvironment(env.config);
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  return {
    server,
    get env() {
      return env;
    },
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(port, () => {
          const addr = server.address();
          const actualPort = typeof addr === "object" && addr ? addr.port : port;
          resolve(actualPort);
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        env.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
