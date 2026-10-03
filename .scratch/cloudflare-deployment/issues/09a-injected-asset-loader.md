# Injected asset loader

Status: ready-for-agent
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

## Comments
