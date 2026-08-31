import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  LocalApartmentOwnerEnvironment,
  resetLocalOwnerFixture,
  DEFAULT_LOCAL_OWNER_CONFIG,
  type LocalOwnerStateOverview,
} from "./local-owner-environment.js";

function formatKobo(kobo: number): string {
  const naira = (kobo / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `₦${naira}`;
}

export function renderOwnerDashboardHtml(overview: LocalOwnerStateOverview): string {
  const latestRequest = overview.pendingRequests[overview.pendingRequests.length - 1];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shortlet Marketplace — Local Apartment Owner Test Surface</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-heading: #f0f6fc;
      --accent: #238636;
      --accent-hover: #2ea043;
      --danger: #da3633;
      --danger-hover: #f85149;
      --warning: #d29922;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
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
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-success { background: #23863633; color: #3fb950; border: 1px solid #238636; }
    .badge-warning { background: #d2992233; color: #e3b341; border: 1px solid #d29922; }
    .badge-info { background: #388bfd33; color: #58a6ff; border: 1px solid #388bfd; }
    .badge-danger { background: #da363333; color: #f85149; border: 1px solid #da3633; }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
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
    .meta-label { color: #8b949e; }
    .meta-value { color: var(--text-heading); font-weight: 500; }
    .mono { font-family: var(--font-mono); }
    
    .actions-panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .btn {
      display: inline-block;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      border: none;
      text-decoration: none;
    }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-danger:hover { background: var(--danger-hover); }
    .btn-secondary { background: #21262d; color: var(--text); border: 1px solid var(--border); }
    .btn-secondary:hover { background: #30363d; }
    
    .btn-group {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }
    
    .request-box {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      background: #0d1117;
      margin-top: 12px;
    }
    
    pre {
      background: #0d1117;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      font-family: var(--font-mono);
      font-size: 12px;
      overflow-x: auto;
      color: #8b949e;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Shortlet Apartment Owner Dashboard</h1>
        <div style="font-size: 14px; color: #8b949e;">Local Developer Simulation & Testing Experience (Local Owner Ready)</div>
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
          <span class="meta-value" style="color: #3fb950;">${formatKobo(overview.payoutProjections.payableNowKobo)}</span>
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
            <div style="margin-top: 12px; color: #8b949e; font-size: 14px;">
              Request finalized with status <strong>${latestRequest.facts.status}</strong>.
            </div>
          `
          }
        </div>
      `
          : `
        <p style="color: #8b949e;">No demo booking requests active. Click below to simulate a verified incoming guest request.</p>
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
          <button type="submit" class="btn btn-secondary" style="color: #f85149;">Reset Fixture</button>
        </form>
      </div>
    </div>

    <!-- API State Payload JSON -->
    <details>
      <summary style="cursor: pointer; color: #8b949e; font-size: 14px; margin-bottom: 8px;">View Authoritative Local State JSON</summary>
      <pre>${JSON.stringify(overview, null, 2)}</pre>
    </details>
  </div>
</body>
</html>`;
}

export function startLocalOwnerServer(options: {
  port?: number;
  environment?: LocalApartmentOwnerEnvironment;
} = {}) {
  const port = options.port ?? 3000;
  let env = options.environment ?? new LocalApartmentOwnerEnvironment();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      const overview = env.getStateOverview();
      const html = renderOwnerDashboardHtml(overview);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const overview = env.getStateOverview();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(overview, null, 2));
      return;
    }

    if (req.method === "POST") {
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
