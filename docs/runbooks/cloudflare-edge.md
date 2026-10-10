# Edge security and observability for the Cloudflare pilot

Steps for the Cloudflare dashboard/DNS that the agent cannot do. The application side (Workers Logs, the
secret-leak test and the security-header parity test) is implemented in `apps/cloudflare`; this checklist is the
human half of slice 13.

Placeholders to fill at deploy time: `<ZONE>` is the pilot's domain, `<WORKER>` is `shortlet-pilot-production`.

## 1. WAF rate-limit rules

Thresholds confirmed with the user (10 requests per minute per client IP for the operator login). Add the rules in
**Security → WAF → Rate limiting rules**:

| Path | Rule | Value |
| --- | --- | --- |
| `POST /operator/login` | Rate limit per IP | **10 requests / 1 minute**, action **Block**, duration 1 minute |

The operator login already has an in-process limiter (issue 19), but it resets when the Durable Object is evicted,
so this rule is the durable backstop (see the PRD note).

### `POST /webhooks/paystack`

The user chose an **IP allow-list** over a rate limit, because Paystack retries and a limit could drop a legitimate
event. In **Security → WAF → Custom rules** add an allow-list for Paystack's published webhook IPs, and block other
source IPs from that path:

- Action: **Block** on `POST /webhooks/paystack` where `ip.src not in { <Paystack webhook IPs> }`.
- Get the current IP list from Paystack's documentation and re-check it at each deploy; do not hardcode a guessed
  list in the repository.

The webhook also verifies its signature against the raw body in the application (ADR 0087), so the allow-list is
defence in depth, not the only control.

## 2. HTTPS-only custom domain

1. **Workers & Pages → `<WORKER>` → Settings → Domains & Routes → Add → Custom domain**: `<ZONE>` (and
   `www.<ZONE>` only if needed).
2. **SSL/TLS → Edge Certificates**: enable **Always Use HTTPS** and set **Minimum TLS Version = 1.2**.
3. Do **not** leave a plain-HTTP route to the Worker.

## 3. Turn off `workers.dev` and preview URLs

In **Workers & Pages → `<WORKER>` → Settings → Domains & Routes**:

- Disable the `workers.dev` route for **production**.
- Disable **Preview URLs** for production so unauthenticated deployment versions are not reachable.

The Worker configuration already carries the deploy-time intent (`workersDev`, `previewUrls` are per-mode in
`cloudflare.config.ts`); the dashboard toggles are the enforcement the agent cannot set.

## 4. Logs

Workers Logs are enabled in `cloudflare.config.ts` (`observability.logs.enabled`, invocation logs off). The pinned
beta CLI has no live tail (verified in slice 01c): inspect logs in the dashboard under
**Workers & Pages → `<WORKER>` → Logs**, or use `cf logs retrieve get` for logs already persisted. Do not expect a
`cf tail` command.

## 5. Verify

- `curl -sI https://<ZONE>/` shows the app's own `Content-Security-Policy` and `Referrer-Policy` unchanged (the
  workerd test `edge-security.spec.ts` asserts the same values through the Worker).
- `http://<ZONE>/` redirects to `https://`.
- `https://<WORKER>.<subdomain>.workers.dev/` is not reachable in production.
- A `POST /operator/login` burst above 10/minute is blocked at the edge.
