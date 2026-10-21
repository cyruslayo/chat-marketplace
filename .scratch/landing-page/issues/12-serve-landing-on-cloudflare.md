# 12 · Serve the landing page on Cloudflare

Status: resolved
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

### Implementation plan and ADR mapping — 20 Oct 2026

Issue 11's implementation is `016ff47` on `landing/11-port-onto-main`; it remains claimed until the issue-15 gate. Work directly, without subagents, on this same wave branch. Use Cloudflare's existing Static Assets-first serving path for **all landing text and binary assets**: extend the existing byte-copy build block and generated `_headers`, not the Worker router, provisioning rules, CSP or domain authority. The Durable Object renders HTML only; no new filesystem loader is needed there. Existing staging provisioning remains unchanged, and tests use the existing local synthetic provisioning fixture, never public/demo inventory.

| ADR | Constraint | Acceptance criterion / code path |
| --- | --- | --- |
| 0078 | Self-hosted assets, constrained-network behavior and accessible fallback remain required. | AC1/2/4: fonts and demo photos stay same-origin; long immutable cache for binaries; retain no-JS page and current presentation. |
| 0081 | Preserve runtime boundaries and deterministic presentation; this issue additionally requires exact asset bytes. | AC3: copy Node CSS/bundle outputs, never rebuild a separate Workers version; compare served bytes with canonical Node source/output. |
| 0095 | Workers/DOs have no normal filesystem; no production/real-person data before the existing launch gates. | AC1/2/4: Static Assets owns these GETs before the Worker; local synthetic tests only, no deployment or real-person data. |
| 0099 | Host composes infrastructure, never booking/payment policy. | AC1–4: build/asset wiring only; no authority, session, provisioning, domain or commerce changes. |
| 0101 | One routing Worker, existing platform/domain ownership and private R2 discipline. | AC1/2: retain router/DO composition; landing files are build assets, not public receipt/product-R2 URLs. |
| 0075 | Same-origin content and minimized data; do not loosen CSP or log credentials. | AC4: inspect actual browser CSP behavior; change shared security headers only if a real blocked required resource is demonstrated. |

Tests first: a dedicated Workers spec with one named test per AC1–3 (public/stale-session landing, every referenced asset; all binary MIME/cache headers and unknown-name 404s; exact Node/Workers text-byte parity), reusing `ops-test-helpers.ts` for provisioned synthetic state. AC4 needs a real browser against the local Workers build, not a CSP-string assertion presented as browser evidence. Add that browser check at the local-host seam after confirming the existing tooling; no competing browser run. Build/check/Workers/landing checks follow implementation; the single consolidated full-suite and complete capture gate remain mandatory in issue 15. No push, deployment, merge or resolution is authorized by this claim.

### Evidence ledger and AC4 status — 21 Oct 2026

Passed: asset-copy build; `npm run check` (run `95ab1241…`); `npm run test:workers -- apps/cloudflare/test/landing-assets.spec.ts`, 3/3 (run `9a649009…`); baseline run `7ecb888f…` showed the same three tests failing with 404 before the wiring.

**Cloudflare CLI failure, diagnosed (two separate causes, no dependency or config change):**

1. "`@cloudflare/vite-plugin` declared but not installed" was caused by running `cf build` directly. `cf`'s detector (`node_modules/cf/dist/discover-*.mjs`) checks only `<cwd>/node_modules/@cloudflare/vite-plugin/package.json` and never walks up. `apps/cloudflare` has no `node_modules`, and the root copy is not seen. The `ensure-worker-deps.mjs` step of `npm run worker:build` exists for this: it runs `npm ci --prefix apps/cloudflare` from the committed lockfile, which already pins `2.0.0-beta.sha-52b0dc0e9`. After it ran, detection passed. The earlier `ERR_PACKAGE_PATH_NOT_EXPORTED` probe was unrelated (the package has an import-only export).
2. `cf build` then fails with `spawn …\bin\cf-vite ENOENT`. That is the Windows limitation already recorded in `docs/runbooks/cloudflare-staging-rehearsal.md` (gap 1): `cf` spawns the extension-less shebang script directly. Running the same delegate through Node, `CLOUDFLARE_CF_AUTH=true NODE_OPTIONS=--no-deprecation node apps/cloudflare/node_modules/@cloudflare/vite-plugin/bin/cf-vite build`, succeeds (exit 0; Worker bundle and client environment built; log `build-12-cfvite.txt`).

**AC4 not yet met.** A dev server on the Workers runtime needs the Vite `fs.allow` widened to the workspace root (`cf-vite dev` itself dies with `Denied ID …/apps/web/src/shortlet-foundations.css?raw`); a throwaway script outside the repo did that and the Worker served locally. Unprovisioned, `/welcome` returns the expected 503 `UNAVAILABLE`. Provisioning a running dev server needs the `/_ops` import, which requires a verified Cloudflare Access JWT fetched from `https://<team>/cdn-cgi/access/certs`; faking that endpoint would be an invented bridge, so it was not attempted. No browser CSP evidence has been produced. Dev server stopped, synthetic `.dev.vars` removed.

### AC4 provisioning attempt: offline DO seed — 21 Oct 2026

Seeding worked. The dev server was started once to create the Durable Object file (`apps/cloudflare/.cloudflare/state/v3/do/shortlet-pilot-development-ShortletPilot/<id>.sqlite`, git-ignored). A scratch script outside the repo then opened it with `openNodeSqliteDatabase` and ran the same `seedIssue01Units` + `createProvisionedOperator` steps as `provisionTenant`, for tenant `tenant-local-development` (2 units). Two synthetic-only `.dev.vars` corrections were needed (removed afterwards): `RESEND_API_KEY` must be blank (notification settings are all-or-none), then the config loads.

**Still blocked, with a likely pre-existing defect (not fixed, no app change made):** `/welcome` now returns a Vite 500, `PAYSTACK_CALLBACK_BASE_URL is required`. `apps/local-guest/src/guest-server.ts:2247` calls `loadPaystackConfiguration()` against `process.env` (same line on main `2d8f6a3`, since commit `639e3cdb`). The Durable Object passes a `payments` module, not a `paystackClient` (`apps/cloudflare/src/shortlet-pilot-do.ts:240`). Workers `process.env` carries only declared bindings, and `cloudflare.config.ts` declares `PAYSTACK_ENVIRONMENT` but not `PAYSTACK_CALLBACK_BASE_URL`; `.dev.vars` entries for undeclared names are ignored. The Workers specs hide this because `wrangler.test.jsonc` sets `PAYSTACK_CALLBACK_BASE_URL`. If so, the built Worker would fail the same way on guest routes in staging. Needs an owner decision: declare the binding in `cloudflare.config.ts`, or have the DO pass `paystackClient`.

### AC4 met — 21 Oct 2026

**Fix (owner-approved, test-first):** `apps/cloudflare/cloudflare.config.ts` now declares `PAYSTACK_CALLBACK_BASE_URL = PUBLIC_ORIGIN[environment]` (the value `loadPaystackConfiguration` already requires to equal the public origin, ADR 0087). New test in `test/cloudflare-config.test.ts` failed first (6 pass / 1 fail), then passed (7/7).

**Real-browser check** against the Workers runtime (Vite dev server using the project's own `vite.config.ts`, widened `fs.allow` only, via a scratch script outside the repo; synthetic `.dev.vars`; DO seeded offline as above; port 3041; shared headless Chrome via `test/helpers/chrome-devtools.ts`). `GET /welcome`: 200 with the unchanged `content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. In the page: `/landing/fonts/newsreader-500.woff2`, `hanken-grotesk-400-700.woff2`, `newsreader-italic-400.woff2`, `/shortlet-foundations.css`, `/shortlet-landing.css` and `/landing.js` all loaded with status 200 and non-zero size; the three font faces reported `loaded`; both stylesheets exposed their rules (10 and 223); `landing.js` executed (script-added `landing-enter`/`landing-pending` classes present). The only non-200 was the browser's automatic `/favicon.ico` (404), unrelated to CSP. No shared security header was changed. No demo photos are referenced in the default (non-demo) page, so none were exercised.

**Caveats:** the browser probe is a scratch script, not a committed test, because it needs the offline-seeded dev server; the procedure above is the record. Dev mode serves `public/` directly, so this proves CSP and resource loading on the Workers runtime, not the production Static Assets front door (covered by `env.ASSETS.fetch` in the Workers spec). Evidence: `npm run check` clean; Workers `landing-assets` + `cloudflare-config` specs 5/5 passed.

## Answer

**Resolved 21 Oct 2026** with 11, 14 and 15 (`338ca27` assets and callback binding, `d6fda26` and `22ec719` build-script fixes). Landing text and binary assets are copied into Cloudflare Static Assets through the existing allow-list with generated MIME and cache headers; the Worker router, provisioning and shared CSP are unchanged. `cloudflare.config.ts` now declares `PAYSTACK_CALLBACK_BASE_URL` (a defect found while running the browser check). Tests: three named Workers tests for AC1–3; Workers suite 24 files / 162 tests green; three full `npm test` runs, the last green.

**Recorded gaps against the Definition of Done (owner proceeded knowing these):** (1) AC4, the real-browser CSP check, has no committed named test. It was run once with a scratch script against an offline-seeded Workers dev server and is recorded in the ledger above; the procedure needs a seeded dev server, so it is not repeatable in `npm test`. (2) That check ran in dev mode, so it proves CSP and resource loading on the Workers runtime, not the production Static Assets front door (covered by `env.ASSETS.fetch` in the Workers spec). Not merged, pushed or deployed.
