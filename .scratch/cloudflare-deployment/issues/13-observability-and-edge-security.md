# Observability and edge security

Status: resolved (agent side; the dashboard and DNS steps remain a human checklist)
Type: task
Blocked by: 10b
Branch: `infra/cf-13-observability-edge`
Requested: 2 Oct 2026
Unlocks: 15

## Why

Production needs logs that carry no secrets, rate limiting at the edge, and HTTPS on the pilot's own domain. The app's in-memory rate limiters (`SlidingWindowRateLimiter` in `apps/pilot/src/pilot-server.ts` `requestGuard`) reset whenever the Durable Object is evicted, so edge WAF rules have to back them up.

## What to build

- **Agent:** enable Workers Logs using the observability setting in `cloudflare.config.ts`. The handlers keep logging nothing about requests. Use a log inspection workflow verified for the pinned `cf` version; if live streaming requires another tool, document that exact fallback.
- **Agent:** add a workers integration test that runs a guest journey, operator login, an ops call and a signed Paystack webhook while capturing every `console.*` call. It fails if any captured output contains:
  - the cookie values, the operator token or the ops shared secret;
  - an `Authorization` value or a Paystack signature;
  - a webhook body.
- **Agent:** confirm the app's own security headers (CSP, HSTS, `X-Content-Type-Options` and so on, whichever the handlers set today) arrive unchanged through the Worker. Add a test that compares them with Node.
- **Human, with an agent-written checklist in `docs/runbooks/cloudflare-edge.md`:**
  - WAF rate-limit rules for `POST /operator/login` and `/webhooks/paystack`. **Ask the user** for the thresholds; don't invent them. For the webhook, an IP allow-list of Paystack's published webhook IPs may fit better than a rate limit, so present both.
  - A custom domain with HTTPS only (Always Use HTTPS, minimum TLS 1.2).
  - `workers.dev` and preview URLs turned off for production.

## Out of scope

- Staging deploys (15).

## Acceptance criteria

- AC1: The secret-leak test passes. Failure path: it fails when a deliberate `console.log(req.headers.cookie)` is added (verified by hand and noted).
- AC2: The security headers through the Worker equal Node's for the same routes.
- AC3: `docs/runbooks/cloudflare-edge.md` lists every dashboard step, with the user's thresholds filled in.
- AC4: `npm run test:workers`, `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0075 | No secrets in logs | AC1 |
| 0086 | Login protected | WAF rule |
| 0087 | Webhook integrity | WAF and the signature check |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`. Item 6 applies directly.

## Comments

## Answer

Resolved 7 Oct 2026 on `infra/cf-13-observability-edge` (agent side).

### Workers Logs

`cloudflare.config.ts` sets `observability: { enabled: true, logs: { enabled: true, invocationLogs: false } }`. Invocation logs are off so no request metadata is recorded; the handlers log nothing about requests and the Durable Object emits only redacted telemetry and alarm-failure records (ADR 0075). The pinned beta CLI has no live tail (verified in 01c), so the runbook records the fallback: the dashboard's **Workers & Pages → Logs** view, or `cf logs retrieve get` for already-persisted logs — no invented `cf tail`.

### Acceptance evidence (`apps/cloudflare/test/edge-security.spec.ts`)

- **AC1**: with `console.log/error/warn/info` captured, a guest page, an authenticated `/_ops` call and a signed Paystack webhook are driven through the Worker; none of the session cookie, the operator token, the `OPS_SHARED_SECRET`, the webhook signature or the webhook body appears in any captured output. (The issue's failure path — a deliberate `console.log(req.headers.cookie)` — is a manual check, as specified.)
- **AC2**: the Guest page's `Content-Security-Policy` and `Referrer-Policy` arrive through the Worker byte-identical to `GUEST_HTML_SECURITY_HEADERS` in the new `packages/platform-core/src/security-headers.ts`. That module is now the **single source** for both servers: `guest-server.ts` spreads `GUEST_HTML_SECURITY_HEADERS` and `local-owner-server.ts` spreads `RECEIPT_SECURITY_HEADERS`, so the Worker and Node cannot drift.
- **AC3**: `docs/runbooks/cloudflare-edge.md` lists every dashboard step with the user's values — WAF **10 requests/minute per IP for `POST /operator/login`**, and a **Paystack webhook IP allow-list** (not a rate limit) with the instruction to re-read Paystack's published IPs at each deploy, plus a custom domain with Always Use HTTPS and TLS ≥ 1.2, and `workers.dev`/preview URLs off for production.
- **AC4**: `npm run check` clean; `npm run test:workers` passes **50** workerd tests; the Vite build emits 327 modules with no `node:sqlite`.

### Human steps still open (dashboard/DNS)

WAF rules, the custom domain/TLS settings and the `workers.dev`/preview toggles are dashboard actions and cannot be performed from here (the pinned `cf` also cannot deploy on this install — see 10b's toolchain gap). The runbook is the checklist for them.

### Note

The `security-headers.ts` extraction touched the two resolved handler files; it is a literal constant substitution, verified by `npm run check` and the workerd specs. The full Node suite could not be run in this shell (the ambient `PAYSTACK_*` gap recorded in 10b); re-run it with the pilot env exported.
