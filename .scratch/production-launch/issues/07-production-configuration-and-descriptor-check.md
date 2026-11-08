# Production configuration and a descriptor check script

Status: ready-for-agent
Type: AFK
Blocked by: 03, 17 (the domain)
Requested: 8 Nov 2026

## Parent

[PRD](../PRD.md), decisions D3 and D12.

## Why

- The production origin in `apps/cloudflare/cloudflare.config.ts:43` is the placeholder `https://pilot.shortlet.example`.
- Operators must hear about Booking Requests within Active Hours (ADR 0042). Notifications only run when `RESEND_API_KEY`, `SHORTLET_NOTIFICATION_FROM` and `SHORTLET_OPERATOR_ALERT_EMAILS` are set; nothing makes them mandatory in production.
- AGENTS.md "Staging deployment" describes a manual descriptor check. Production needs the same check, and a script is safer than reading the JSON by hand.

## What to build

- Set the production origin from issue 17.
- Production refuses to start without Resend, the notification sender and at least one operator alert address (staging may keep them optional).
- `scripts/verify-worker-descriptor.mjs <staging|production>`: reads `apps/cloudflare/.cloudflare/output/v0/workers/default/worker.config.json` and checks, **without printing any value**: worker name, the exact secret binding names (now including issue 03's key and, in production, `RESEND_API_KEY`), `COMMERCE_ENABLED` false, `PAYSTACK_ENVIRONMENT` (`test` on staging, `live` on production), `SHORTLET_DEMO` absent in production, the origin, the model-call cap and the Access vars.
- Document the production build env and the owner's deploy command next to the staging one in AGENTS.md.

## Acceptance criteria

- [ ] AC1: The production build uses the real origin; no file references `pilot.shortlet.example` outside tests.
- [ ] AC2 failure path: production startup refuses missing Resend or operator alert settings.
- [ ] AC3: The script passes on a correct staging and production build and fails, naming the field only, on each wrong field.
- [ ] AC4: The script never prints a binding value (tested).
- [ ] AC5: AGENTS.md lists the production build env, the verify command and the deploy command the owner runs.

## ADRs to read

0042, 0075, 0087, 0095, 0104, 0105.

## Comments
