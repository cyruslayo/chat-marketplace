# 12 · Serve the landing page on Cloudflare

Status: ready-for-agent
Type: task
Blocked by: 11
Requested: 20 Oct 2026

## Why

On Cloudflare the Worker sends every path except `/account`, `/api/threads` and `/threads` to the SHORTLET Durable Object (`apps/cloudflare/src/worker.ts:9-13`, `:48`), so `/welcome` reaches the guest app. But:
- Static Assets currently publishes only the four client bundles and the foundations CSS (`apps/local-guest/scripts/build-client.mjs`, the `apps/cloudflare/public` copy block and its `_headers`);
- the Cloudflare asset loader serves text assets only, and any other name throws (`apps/cloudflare/src/pilot-assets.ts:14-16`).

So the landing stylesheet, script, fonts and photos would fail there.

## What to build

- **Binary assets** (the three WOFF2 fonts and the landing photos) are published through Cloudflare Static Assets in `apps/cloudflare/public/`, with `_headers` entries:
  - fonts: `font/woff2`, `Cache-Control: public, max-age=31536000, immutable`;
  - photos: the image type and long-cache headers.
- **Text assets** (`shortlet-landing.css`, `landing.js`) are served with identical bytes on Node and Cloudflare (ADR-0081), through the extended `AssetName` union from issue 11 or through Static Assets. Pick one route per asset and record why.
- The landing route module's binary loader gets its Cloudflare implementation, or the route module leaves those paths to Static Assets on Cloudflare. Either way, the Worker and the Durable Object never 500 on a landing asset.
- **Security headers:** check that `packages/platform-core/src/security-headers.ts` allows the self-hosted fonts and photos (on 20 Oct 2026 the CSP was `default-src 'self'; … img-src 'self' https:`, which should already cover them). Change nothing unless a test shows a block.

## Acceptance criteria

1. In the Workers test environment, `GET /welcome` returns the landing page and every asset it references returns 200 with the right content type
2. Fonts and photos are served with long-cache immutable headers, and an unknown landing asset returns 404, not 500
3. The landing stylesheet and script bytes are identical on the Node host and on Cloudflare
4. The page loads with no Content-Security-Policy violation in a real browser against the Workers build

## Rules

- AGENTS.md protocol, with an ADR table: 0081, 0095, 0101, 0078.
- Run `npm run check`, `npm run test:workers`, the landing test files, then `npm test` once in the background.
- No deployment and no push. Ask the owner before merging.

## Comments
