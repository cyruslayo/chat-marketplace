# Injected asset loader

Status: resolved
Type: task
Blocked by: 08c
Branch: `infra/cf-09a-asset-loader`
Requested: 2 Oct 2026
Unlocks: 09b

## Why

The handlers read files from disk:
- the foundations CSS at module load: `guest-server.ts:221` and `local-owner-server.ts:37`;
- the client bundles per request or at start: `guest-server.ts:7059` (`gallery.js`), :7081 (`payment.js` / `offer.js`) and :7102 (`client.js`).

A Durable Object has no filesystem, and module-level `readFileSync` would fail at import time there.

## What to build

- An `AssetLoader` interface, for example `{ text(name: AssetName): string }`, where `AssetName` is the closed union `"shortlet-foundations.css" | "client.js" | "gallery.js" | "offer.js" | "payment.js"`.
- `nodeAssetLoader()` reads today's paths, preserving the current resolution (`clientScriptPath` option, `apps/local-guest/dist/`), and caches each file after its first read.
- Both handlers take `assets: AssetLoader` in their options. **Remove every module-level `readFileSync`.** CSS that is inlined into pages comes from `assets.text("shortlet-foundations.css")`.
- The Node wrappers and the pilot pass `nodeAssetLoader()`, so behaviour is unchanged.
- Decide how Cloudflare serves the bundles, and record the decision in `## Comments` for 09b and 10b:
  - Static Assets serve `/client.js` and the other bundles before the Durable Object is reached. The handler's script routes are then simply never hit on Cloudflare.
  - Inlined CSS needs text inside the Durable Object. Select an import or generated asset mechanism supported by the `cf` build implementation verified in 01c; do not assume Wrangler-specific `Text` module imports work.

## Out of scope

- The build output for Cloudflare (09b). Don't change asset content.

## Acceptance criteria

- AC1: Neither handler module calls `readFileSync` at import time. Failure path: a test imports both modules with a stub loader while `process.cwd()` points at an empty temp directory, and the import succeeds.
- AC2: With a stub `AssetLoader`, the pages inline the stub CSS and the script routes serve the stub bundles, with today's `Content-Type` and `Cache-Control`.
- AC3: A missing asset gives a 500 error page for that request, not a crash at import.
- AC4: `npm test`, including the Chromium journeys and the foundation-CSS regex tests, passes. `npm run check` is clean.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0081 | The Weaver host owns recovery; bundles served unchanged | identical bytes |
| 0080 | No-JS pages still get CSS | inlined CSS through the loader |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`. Don't run a formatter over `shortlet-foundations.css` (AGENTS.md).

## Answer

Implemented at `eb2a228` on `infra/cf-09a-asset-loader`, merged (fast-forward) into `infra/cloudflare-deployment`.

- **AC1** — `test("09a AC1: neither handler module reads files into pages at import time")`: a source scan proves no `readFileSync` call remains in `guest-server.ts`/`local-owner-server.ts`, and a fresh subprocess (`test/helpers/asset-import-probe.mjs` with `tsx/esm/api register`) imports both handler modules with `process.cwd()` at an empty temp directory — a cached in-process import would not re-run module-level code.
- **AC2** — `test("09a AC2: a stub AssetLoader inlines the stub CSS and serves the stub bundles with today's headers")`: the stub CSS is served by the guest and owner CSS routes with today's `Content-Type: text/css; charset=utf-8` and `Cache-Control: public, max-age=3600`, and all four stub bundles with `Content-Type: text/javascript; charset=utf-8` and **no** `Cache-Control` — exactly today's headers.
- **AC3** — `test("09a AC3: a missing asset answers per request, not a crash at import")`: a throwing loader gives the CSS route and `client.js` a per-request 500, and keeps the gallery/payment/offer 404s with their exact `run npm run guest:local` copy (the four error responses are preserved from the previous per-request `readFileSync` catch paths).
- **AC4** — The foundation-adjacent suites pass in the slice worktree (design-system, weaver host, shell/dependency boundary files); the full `npm test` including the Chromium journeys and the foundation-CSS regex tests is verified on the integrated Wave 4 snapshot at wave close (browser phase once). `npm run check` and 22 workerd tests pass.
- The readFileSync-based behaviors moved to the loader are byte-identical: `nodeAssetLoader()` resolves the same paths and caches after first read; the clientScriptPath resolution lives inside the loader. ADR 0080 (no-JS pages still get CSS) holds — the CSS route is unchanged and now served through the loader; ADR 0081 (identical bytes) is asserted by hash tests in 09b for the copied bundles.

## Comments

- **Decision recorded for 09b and 10b: how Cloudflare serves the bundles and the inlined CSS.**
  - **The four bundles and the CSS route never wake the Durable Object.** Cloudflare Static Assets serve `client.js`, `gallery.js`, `offer.js`, `payment.js` and `shortlet-foundations.css` from `apps/cloudflare/public/` (built by 09b from `apps/local-guest/scripts/build-client.mjs`) before the Worker routes to the Durable Object, so the handler's script routes are simply never hit there. `_headers` mirrors each route's `Cache-Control`/`Content-Type` exactly as the Node handlers send them.
  - **Inlined/link-served CSS text inside the Durable Object comes from a Vite `?raw` import** of `apps/web/src/shortlet-foundations.css` (a `declare module "*.css?raw"` declaration in `apps/cloudflare/src/env.d.ts`). Reasoning: the `cf` build delegates to Vite (`@cloudflare/vite-plugin` verified in 01c via `bindings.assets`, `cf dev` and `cf build`); `?raw` is core Vite behavior, not a Wrangler Text-module rule, and it keeps no generated duplicate of the CSS in the repo. **Fallback if the pinned beta plugin cannot inline `?raw` in `cf build` (09b must verify with a real `cf build` and record evidence):** generate a TypeScript string module beside the bundle copies in the same build script, imported by the Cloudflare loader.
- **7 Oct 2026, wave close: the AC4 deferral is discharged.** On the integrated snapshot `cdcae50`, full serial `npm test` exited 0. That run includes the Chromium journeys and the foundation-CSS regex tests. Phase 1 also passed in chunks: 1,381 tests, zero failures. `npm run check` is clean. The pilot acceptance journey in the in-app browser loaded `client.js` and `shortlet-foundations.css` through the loader on every guest screen. See `../wave-4-acceptance.md`.
