# 11 · Port the landing page onto main as a route module

Status: claimed
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

### Implementation plan and ADR mapping — 20 Oct 2026

Branch `landing/11-port-onto-main` has been synchronized with approved `main` (`2d8f6a3`) without merging the old landing branch. Work directly per owner instruction. Port only the seven landing source files, landing CSS, fonts/photos/licenses, the three landing tests and their two fixtures/helpers, and the direction doc. Adapt only the route-module composition, text/binary asset-loader seams, build script, the two Chrome helper methods, and the owner-approved demo/public image distinction. Do not edit foundations CSS, domain implementation, unrelated harness behavior or existing expectations without recording an exact mapping. Issue 12 owns Workers delivery; issue 14 owns message handoff; issue 15 owns final captures and wave resolution.

| ADR | Constraint | Acceptance criterion / code path |
| --- | --- | --- |
| 0004 | Backend is authoritative; examples confer no transaction authority. | AC1, demo test: presentation-only mode cannot seed/publish bookable Units or take payments. |
| 0005 | Request to Book, not instant reservation or payment. | AC1/4: preserve approved example copy and actions. |
| 0008 | Only inspected published Units may be booked; photos are bounded claims. | AC1/4 and demo tests: false approval flags remain false; labelled illustrations are not live inventory. |
| 0015 | All-In Stay Total for specified dates/party. | AC4: preserve existing app-layer money text and snapshot. |
| 0016 | Deposit separate; collection gate unchanged. | AC4: conditional approved deposit wording, no collection authority added. |
| 0023 | Short Stays are 1–14 nights. | AC1/4: preserve chips and stay examples. |
| 0041 | Request hold starts at disclosure, with bounded response window. | AC4: preserve canonical request/deadline example. |
| 0044 | Payment Window and verified success precede Reservation. | AC4: preserve existing payment example; no transaction route added. |
| 0075 | Untrusted origin/form data; no credential/session leakage. | AC1–3: public session-free landing, same-origin theme POST, exact theme values, no-store cookie response. |
| 0077 | App-layer mockups use canonical kit/content. | AC4: keep phone text fixture and shared markup; no invented missing-photo copy. |
| 0078 | WCAG/reflow/44px/reduced-motion/no-JS. | AC1/4 and wave 15: preserve CSS/motion; native theme form; approved demo notice is readable without JS. |
| 0081 | Preserve Weaver boundary and identical asset bytes. | AC1–3/5: extended text loader and built output; no domain/runtime changes. |
| 0092 | Counsel-gated Extended Stays are not guest-facing. | AC4: owner selected 1–14-night landing; add the approved Furnished glossary term separately as documentation, not policy. |
| 0095 | Durable Objects have no filesystem; data-protection gates remain. | AC3: no import-time reads; injected binary/text loaders, Node adapter only. |
| 0099 | Host composes RouteModules, no business rules. | AC2/5: landing module before shortlet; no public-session allow-list edits. |
| 0100/0101 | Stays/commerce remain separate; public commerce stays off by owner decision. | AC1/5: stays-only page, no Shop, keep pilot/Worker composition unchanged. |
| 0104 (proposed only) | Does not itself bind policy; owner separately approved stays-first scope. | AC1/5: keep draft proposed, implement the explicit owner decision rather than assuming acceptance. |

Test seams: the composed guest HTTP handler and an isolated RouteModule shell with injected assets; fresh module import/lazy-loader calls; unchanged legacy landing tests and boundary suites; pure public/demo render and production refusal of demo Unit ids. Add mirrored named checks for AC1–5 plus the two owner-approved demo behaviors, observe red before port/implementation, then build/check/targeted tests. Browser tests/captures run only after the prior issue's browser process is gone. Final full-suite, Workers and visual gate remain mandatory in the landing wave; do not resolve this issue early.

### Port implementation and verification in progress — 20 Oct 2026

The landing is composed before commerce/shortlet, with lazy injected text/binary assets and exact binary allow-lists. The Node loader and landing build step are in place; the existing Cloudflare copy block is retained for issue 12 to extend. Public renders omit all unapproved images, including the phone/chat examples. Explicit demo rendering shows the approved notice and illustrative photos without adding inventory or transaction authority; original approval flags are unchanged. The landing CSS remains byte-identical to `feat/landing-page` (Git blob comparison), and foundations CSS is untouched.

Test-first evidence is in the root workspace's `.scratch/test-runs/<id>/{run.json,output.log}`:

| Run | Result |
| --- | --- |
| `572ef596-0d10-4dc7-9e89-27614b942553` | Initial red: 1 pass, 6 failures before port/runtime implementation. |
| `b659b10c-0c74-4d09-8d9c-1e091628a79b` | Build passed; generated bundles, not hand-merged. |
| `4d904046-435a-4913-9157-62a6bfef05d5` | First compiler run caught the old branch's two obsolete environment-constructor calls. |
| `d908f337-a33c-4914-bef1-57b2b23930f4` | `npm run check` passed, including Workers type/bundle checks. |
| `2d2939f9-1dd0-4048-bf91-64145e1525dd` | Dedicated AC1–5 and both demo checks: 7/7, including existing domain/Weaver suites. |
| `f6cf4fa2-8c3f-4f87-836c-afa8e5b3e601` | Existing landing unit/motion expectations: 40/40. |
| `14efd21b-3e3e-44b4-b2be-0b4c32530791` | Original browser file: 41 passed, one app-bar assertion failed, one owner-deferred photo-budget test still skipped. Finished before any next browser run. |
| `591158c9-6d0c-4193-bde6-a2c007b2b79c` | Isolated failing check reproduced with a tagged time-only probe: opaque immediately, transparent after 350ms; class stayed on-photo and CSS reported 250ms transitions. This is assertion readiness, not an environment exception. |
| `d07bfd41-6b30-45c2-a2e0-ae7620e8a199` | Same isolated check passed after awaiting the already-required transparent state; no style or visual expectation changed. Probe removed. |
| `43d37996-5109-4661-acf9-81f00d62ac78` | Dedicated checks still 7/7, now also invoking the existing fresh-process asset-import tests under AC3. |
| `8d0e59b5-69ed-4519-b025-799f65239e3c` | Entire existing landing browser file passed: 42 passes, one unchanged owner-deferred skip; exit 0 and `endedAt` verified. No competing browser suite/capture process was started. |

AC4 old → new adaptation ledger (no existing asserted expectation removed or relaxed):

- Test setup: `new LocalGuestEnvironment(options)` → `LocalGuestEnvironment.openNode(options)` in the two imported files, matching main's dependency-injected constructor/Node factory.
- App-bar readiness: class-present → class-present **and the same asserted transparent computed background**, because its existing 250ms transition starts after the class appears. The exact transparent/solid, focus, sticky-position and no-layout-jump assertions remain.
- Imported browser fixture teardown: silently ignored browser/server-close errors → always close the server, propagate failures, and release the shared lock only after successful browser termination. Tab-close recovery remains best effort because browser termination is authoritative. This prevents false passes and lock-release races; no browser-helper lifecycle/transport behavior changed.
- Main's Chrome helper: only the two requested methods/types/return entries were added; eight unchanged best-effort cleanup catches gained explanatory comments, with no suppression directives or behavior change. One unused pre-capture DOM measurement was removed from the imported test; its existing post-capture measurement/assertions remain.

Active LSP probes reported no findings in changed landing files but could not positively certify silent-clean files, so the successful compiler check is the type-check evidence. Separately, active root-workspace probes reproduced pre-existing errors in unchanged capture scripts: `capture-23.ts:44` and `capture-27.ts:141` omit `paymentReferenceKeys`; `capture-phase2.ts:9` uses the obsolete one-argument constructor. These are outside this port and were recorded as session deferrals, not silently fixed or suppressed. Root tracked status remains only the inherited `HANDOFF.md` modification. The new demo-capture check then caught the notice behind the sticky app bar (`4f6e7cee-d32e-4b48-a67e-567282ffb277`, notice top 0 versus header bottom 65). Moving that existing kit banner into the hero's padded introduction fixed the cause without changing CSS or copy. Run `82e7af2b-c62c-4b8a-9165-ad6ccbebc8e7` passed at 320, 390, 768 and 1280 in light and dark: no horizontal overflow, no controls under 44px, no text under 12px, and the notice below the header. Eight captures and `demo-findings.json` are under `screenshots/11/`; the 320-light and 1280-dark screens were also inspected visually. Final compiler/bundle check `019a6075-313c-420e-bc69-41fcbca9ef61` and dedicated acceptance run `35149990-5756-4e0c-bf6f-0f75ddfe1955` both passed. The new demo check is additional to the original browser expectations; its selected run does not claim to be a whole-file rerun.

Self-review against the ADR table found no authority/policy change: loaders and composition are host concerns, image flags remain false, the banner is presentation-only, kit/content reuse and byte-preserving CSS are retained. This is direct-agent self-review, not independent review. Whitespace review found only the original trailing space in each bundled OFL license (Hanken Grotesk line 22, Newsreader line 21); both third-party license texts are preserved byte-identically rather than reformatted. All other staged files pass `git diff --cached --check`. Full-suite/Workers/final visual wave gates remain for issue 15; issue remains claimed and must not be resolved or merged yet.
