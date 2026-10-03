# Build static assets for Cloudflare

Status: ready-for-agent
Type: task
Blocked by: 03a, 09a
Branch: `infra/cf-09b-static-assets`
Requested: 2 Oct 2026
Unlocks: 10b

## Why

Cloudflare Static Assets serve the browser bundles and the CSS from the edge without waking the Durable Object. They need a build output directory and headers that match today's caching.

## What to build

- Extend `apps/local-guest/scripts/build-client.mjs`. It already emits **four** IIFE bundles to `apps/local-guest/dist/`: `gallery.js`, `offer.js`, `payment.js` and `client.js`. Also write the four bundles and `apps/web/src/shortlet-foundations.css` (copied byte for byte, never formatted) into `apps/cloudflare/public/`. Keep the existing `dist/` output, because Node uses it.
- `apps/cloudflare/public/_headers` mirrors each asset's current `Cache-Control` and `Content-Type`, as set in `guest-server.ts` around :7059–7102. Read the real values; don't guess them.
- Add `apps/cloudflare/public/` to `.gitignore`, except `_headers`.
- If 09a chose an imported/generated asset for inlined CSS, make sure it is supported by the `cf` build implementation verified in 01c and importable from `apps/cloudflare/src`.
- `npm run build` produces both outputs.

## Out of scope

- `cloudflare.config.ts` static asset settings (10b).

## Acceptance criteria

- AC1: After `npm run build`, `apps/cloudflare/public/` contains the four bundles and the CSS, each byte-identical to the Node-served version. A test compares hashes.
- AC2: `_headers` gives each asset the same `Cache-Control` the Node server sends. A test parses `_headers` and compares it with a Node response.
- AC3: `shortlet-foundations.css` in `public/` is byte-identical to the source. Failure path: the test fails if any whitespace differs.
- AC4: `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0081 | Weaver bundles served as static assets | public/ |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments
