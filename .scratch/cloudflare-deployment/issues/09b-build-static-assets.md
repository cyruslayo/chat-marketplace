# Build static assets for Cloudflare

Status: resolved
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

## Answer

Integrated at `c9237eb` (branch `infra/cf-09b-static-assets`), merged into `infra/cloudflare-deployment`.

- **AC1** — `test("09b AC1: npm run build writes the four bundles into apps/cloudflare/public byte-identical to the Node output")` runs the real build script and compares the four `apps/cloudflare/public` bundles byte for byte with `apps/local-guest/dist`.
- **AC2** — `test("09b AC2: _headers mirrors each asset's Cache-Control exactly as the Node server sends it")` reads the real values from a live `startLocalGuestServer` response (CSS: `public, max-age=3600`; the four scripts: none), parses the committed `apps/cloudflare/public/_headers`, and compares per asset — including that each script carries `Content-Type: text/javascript; charset=utf-8` and **no** Cache-Control, and the CSS `text/css`.
- **AC3** — `test("09b AC3: the foundations CSS copy is byte-identical to the source; any whitespace drift fails")` compares the copy with `apps/web/src/shortlet-foundations.css` as raw bytes (fails on any whitespace drift).
- **AC4** — `npm run check` clean (the `?raw` type declaration compiles), 22 workerd tests pass, and the full `npm test` on the integrated Wave 4 snapshot runs at wave close.
- `apps/cloudflare/public/*` is gitignored except `_headers` (committed); the values in `_headers` are read from the real handlers, not guessed. `apps/cloudflare/src/foundation-css.ts` imports the source CSS with Vite `?raw` (with the `"*.css?raw"` declaration in `src/env.d.ts`), making the importable-from-`apps/cloudflare/src` requirement real and type-checked now.

## Comments

- The 09a decision is exercised at the type level here: `foundation-css.ts` compiles through the pooled `apps/cloudflare` tsconfigs. **A real `cf build` proof is deferred to 10b**, because `cf build` reports "No Cloudflare dev-server is installed in this project" before that slice creates the project's Vite config — 10b's gate is exactly that build. If the pinned beta plugin fails to inline `?raw` there, the fallback recorded in 09a (a generated TypeScript string module emitted by this same build script) applies; the script change is already in place to add that emit.
- Build-out note: in slice worktrees whose `node_modules` is a junction, esbuild's bundle header comments embed the junction's resolved path (`../chat-marketplace-cloudflare/node_modules/...`), which produces comment-only churn in the tracked `apps/local-guest/dist` files. `dist` churn was reverted for the clean commit; the committed `dist` builds come from the integration worktree's real `node_modules`.
