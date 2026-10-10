# Staging deployment mode for the closed beta

Status: resolved
Type: task
Blocked by: none

## What to build

Production composition refuses Paystack test mode (`domains/shortlet/src/paystack.ts:56`, `apps/pilot/src/pilot-server.ts:66`), and `pilot:local` uses a fake PSP and non-secure cookies, so a test-payment closed beta has nowhere to run. Add `SHORTLET_DEPLOYMENT=production|staging`. Staging permits Paystack test keys but keeps HTTPS, secure cookies, persistent paths and no fixture routes, shows a persistent beta banner, and requires an invite code before a guest session starts. Production behaviour is unchanged (ADR 0087, 0088).

## Acceptance criteria

- [x] Staging starts with Paystack test keys.
- [x] Production still refuses Paystack test keys.
- [x] Any `SHORTLET_DEPLOYMENT` value other than `production` or `staging` fails startup; unset means production.
- [x] Staging still requires an HTTPS public origin and persistent paths, and mounts no fixture routes.
- [x] Every staging guest and operator page shows the beta banner.
- [x] Staging requires a configured invite code before a guest session starts.

## Answer

Implemented on branch `launch/staging-and-build` (stacked on `launch/llm-providers`).

- `apps/pilot/src/pilot-config.ts`: `pilotDeployment`, `betaInviteCode`. Staging loads Paystack with test rules and then requires `environment === "test"`, so a beta that says payments are tests can never hold live keys.
- `apps/pilot/src/pilot-server.ts`: expected Paystack environment follows the deployment. `withBetaBanner` is applied in the proxy to every `text/html` response from the Guest and Operator apps, including error pages and future pages, with `content-length` recomputed. JSON, scripts, HEAD and encoded responses pass through untouched.
- `apps/local-guest/src/guest-server.ts`: `betaInviteCode` gate at the only place a Guest session is issued (`GET /`). SHA-256 plus `timingSafeEqual` comparison; 303 to `/` after the session is created, to drop the code from the URL. The gate is a plain GET form (ADR 0080).
- Startup banner prints `environment=staging`.
- Tests: six staging tests in `test/pilot-production-composition.test.ts`, one per criterion.
- Verified for real on a clean production install: gate 200 with no cookie, wrong code 403, invite 303 with a Secure/HttpOnly cookie, banner on `/` and `/operator/login`, and live keys refused with "Staging requires PAYSTACK_ENVIRONMENT=test".
- ADRs: 0080 (no-JS gate), 0087/0088 (production stays live-only), 0075 (the invite code is never logged or printed).
