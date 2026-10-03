# Observability and edge security

Status: ready-for-agent (the Cloudflare dashboard and DNS steps need a human)
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
