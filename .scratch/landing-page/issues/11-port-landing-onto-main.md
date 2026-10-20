# 11 · Port the landing page onto main as a route module

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 20 Oct 2026

## Why

The landing page (issues 01–10) lives only on `feat/landing-page` (commits `44fcec4` and `e17e937`). Since then `main` has had the multi-domain platform work (`.scratch/multi-domain-platform/`). In particular, slices 14a and 14b split `guest-server.ts` into a shell (`apps/local-guest/src/guest-shell.ts`, `RouteModule` at `:10-13`), the shortlet dispatch and `shortlet-app.ts`.

**Do not merge `feat/landing-page`.** It also carries three old WIP snapshot commits (`b48cfbf`, `221904f`, `6f162fd`) that `main` has superseded; a merge produces 109 conflicts. The two landing commits on their own conflict in only two files: `git merge-tree --write-tree --merge-base=6f162fd main feat/landing-page` reports `apps/local-guest/scripts/build-client.mjs` and `apps/local-guest/src/guest-server.ts`.

Owner decisions, 20 Oct 2026: the landing page is a **stays page** for the stays-only launch, and commerce stays off (`../../multi-domain-platform/issues/30-defer-commerce-until-stays-launch.md`).

## What to build

Work on a new branch cut from `main` (for example `landing/11-port-onto-main`).

1. **Bring over the new files unchanged:**
   - `apps/local-guest/src/landing-*.ts` (brand, copy, motion, page, page-html, photos, units);
   - `apps/web/src/shortlet-landing.css`;
   - `apps/local-guest/assets/` (fonts and landing photos, with their CREDITS and OFL files);
   - `test/landing-page*.test.ts`, `test/helpers/landing-tokens.ts` and `test/fixtures/landing-phone-text.json`;
   - the landing docs and issues.

   Use `git checkout feat/landing-page -- <paths>` for exact paths, or cherry-pick and resolve. Check that every import still resolves on `main`: the guest-kit, web-agent and ui-kit exports used were present on 20 Oct 2026.
2. **Add the two test-helper methods** to `main`'s `test/helpers/chrome-devtools.ts` (`getPlatformFonts`, `setNetworkProfile`) by hand. Keep `main`'s version of that file.
3. **Create `apps/local-guest/src/landing-route-module.ts`,** a `RouteModule` modelled on `commerce-route-module.ts`. It owns:
   - `GET /welcome` and `POST /welcome/theme` (keep the origin check and the `shortlet_theme` cookie);
   - `/shortlet-landing.css`, `/landing.js`, `/landing/photos/*` and `/landing/fonts/*`, served from allow-lists (never a path built from the URL).

   Register it in the shell's `routeModules`, before the shortlet module (`guest-server.ts:4642`). It then needs no `PUBLIC_GUEST_PATHS` edits, because the session gate is inside the shortlet dispatch. Do not re-apply the branch's `guest-server.ts` hunks.
4. **No `readFileSync` at module level** (a Cloudflare Durable Object has no filesystem: `packages/platform-core/src/asset-loader.ts:2-13`):
   - text assets (`shortlet-landing.css`, `landing.js`) go through the `AssetLoader`, with the `AssetName` union extended;
   - the binary assets (WOFF2, JPG) come from a small injected loader with a Node implementation. Issue 12 adds the Cloudflare side.
5. **`build-client.mjs`:** keep `main`'s Cloudflare public-copy block and the branch's `landing.js` esbuild step. Regenerate `apps/local-guest/dist/*` by running the build; never hand-merge it.
6. **Keep the landing on stays copy only.** Nothing on the page may mention Shop or commerce while issue 30 stands.

## Acceptance criteria

1. On `main`'s shell, `GET /welcome` renders the landing page with its stylesheet, script, fonts and (with placeholders on) photos, and the shortlet guest app routes behave as before
2. `/welcome` and its assets are served by a landing route module registered before the shortlet module, and unknown asset names return 404
3. No landing code reads the filesystem at module load; assets come from an injected loader
4. Every existing landing test passes on `main` without weakening (list any expectation that had to change because of `main`'s structure, with old → new)
5. The domain boundary tests and the weaver dependency boundary test still pass

## Rules

- AGENTS.md implementation protocol, with an ADR table in `## Comments`: 0077, 0078, 0081 (identical asset bytes), 0095, 0099, 0101, plus the landing ADRs listed in issue 08.
- Do not edit `shortlet-foundations.css`, and never run a formatter over CSS.
- Run `npm run check`, then the landing test files (one browser run at a time), then `npm test` once in the background, then `npm run test:workers`.
- Commit on the branch; ask the owner before merging to `main`.

## Comments

### Read-only port discovery — 20 Oct 2026

No landing code has been ported yet. Branch `landing/11-port-onto-main` currently contains only `f4c02da`, recording the owner's issue-13 selections (a), items 1–5. Modern web guidance was searched and its HTML guide read; relevant landing/hosting ADRs were discovered and read before implementation planning.

**Scope conflict for owner confirmation:** "bring over the new files unchanged" would retain public unapproved photographs. On `feat/landing-page`, `landing-page-html.ts` gates the brand hero/closing images and apartment cards, but `resultRow()` always supplies `stay.livingPhoto`; `beatTwoScreen()` and `beatFiveScreen()` also emit the example JPEGs without the `placeholders` gate. `apps/local-guest/assets/landing/CREDITS.md` identifies all four JPEGs as temporary Unsplash placeholders, and every photography approval flag is false. This contradicts the session rule that placeholders/unapproved photos never render on the public page.

Recommendation sent to the owner: permit the smallest renderer change within this port to gate **all** unapproved images on the public render while preserving the explicit local placeholders preview. Reuse the existing no-photo kit treatment; do not invent copy, approve photos, modify foundations CSS, or alter approved phone-screen text. Keep existing tests at their current strength and add public-render image-request coverage; report any necessary old → new expectation mapping. Await confirmation before this renderer change.

### Owner clarification — 20 Oct 2026

The owner clarified that the current photos must remain available for live demonstrations before Operators and their listings are onboarded. The owner then replied **"yes"** to the explicit recommendation: a demo mode labelled **"Demo — illustrative photos, not live listings."**, with real bookings and payments unavailable for demo inventory.

This authorizes the labelled demo presentation and that exact label, not publication of fictional Units or approval of the Unsplash files as real Unit photography. Preserve the original approval flags. Normal public mode must suppress all unapproved images, including inside the chat/phone examples; explicit demo mode may show these current photos. Demo mode is presentation only: it must not seed, publish or expose demo Units as bookable inventory, change stays policy or payment controls, or enable commerce. Add tests distinguishing normal/public and demo renders, and proving the sample Unit ids have no booking/payment authority. The real-photography and FAQ approvals in issue 13 remain open.
