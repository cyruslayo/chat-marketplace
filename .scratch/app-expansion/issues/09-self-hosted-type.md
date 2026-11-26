# Self-hosted type, measured on a slow phone

Status: resolved
Type: task
Blocked by: 07

## What to build

- Newsreader 500 and 400 italic, and Hanken Grotesk 400, 600 and 700 (five files, the kit's limit), subset to the characters the product uses, including ₦, as WOFF2 from our own origin. Keep the OFL notices.
- `font-display: swap`, system fallbacks, and size-adjusted fallbacks so text does not jump.
- Money stays in Newsreader (Hanken Grotesk has no ₦).
- Serve with long caching; add the files to the Worker asset guard and the landing assets.

## Acceptance criteria

- AC1: No third-party font request on any page.
- AC2: Text is readable before fonts load. The measured layout shift is reported; if the project has no limit, ask the owner for one.
- AC3: First render on the reference setup (low-end Android profile, slow network) is recorded before and after on five screens. The owner accepts the difference before merge.
- AC4: Every ₦ amount renders in Newsreader. With fonts blocked it renders in the fallback and nothing overlaps.
- AC5: The Worker bundle guard and the asset specs pass.

## ADR compliance

0078, 0095.

## Comments

### ADR compliance

| ADR | Constraint | Affected AC / Code Path |
| --- | --- | --- |
| **ADR 0078** | Nigerian launch profile: WCAG 2.2 AA contrast, 320px reflow, degraded Nigerian mobile networks, text before media (`font-display: swap`), no third-party font requests, unambiguous NGN/₦ display in Newsreader. | AC1–AC4; `apps/web/src/shortlet-foundations.css` (`@font-face`, size-adjusted fallbacks, `--font-sans`, `--font-display`, money rules), `test/self-hosted-type.test.ts` |
| **ADR 0095** | Cloudflare Workers hosting: no `node:fs` or module-scope `import.meta.url` in Worker graph; static asset parity between Node and Cloudflare Workers (`ASSETS`). | AC5; `apps/local-owner/src/local-owner-server.ts` (`binaryAssets` option defaulting lazily inside `createOwnerRequestHandler`), `scripts/check-worker-bundle.mjs`, `apps/cloudflare/test/landing-assets.spec.ts` |
| **ADR 0107** | Mode tokens stay isolated and never drive money or status typography. | `apps/web/src/shortlet-foundations.css` |
| **ADR 0108** | Shared foundation tokens consumed across Guest and Operator surfaces. | `test/shortlet-token-parity.test.ts` (now reads `design/round-12/tokens.json` light & dark + spacing/radius) |

### Implementation summary

- **Self-hosted WOFF2 faces (`apps/web/src/shortlet-foundations.css`):** Reused the 3 subsetted WOFF2 files in `apps/local-guest/assets/fonts/` (`newsreader-500.woff2` 24,724 B, `newsreader-italic-400.woff2` 24,052 B, `hanken-grotesk-400-700.woff2` 23,600 B; total 72,376 B <= 160 KB limit, Latin + `U+20A6` ₦ in Newsreader; `OFL-Newsreader.txt`, `OFL-HankenGrotesk.txt`, `CREDITS.md` already present). Added `@font-face` rules with `font-display: swap;` and metric-adjusted fallback `@font-face` rules (`"Newsreader Fallback"` and `"Hanken Grotesk Fallback"` with `size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`) ahead of system stacks.
- **Money in Newsreader:** Set `.ui-money-total`, `.ui-facts dd.ui-money-total`, `.ui-price-breakdown__value`, `.ui-price-breakdown__due .ui-price-breakdown__value`, `.ui-result-row__price`, and `.ui-action-bar__sum > strong` to `font-family: var(--font-display)` (`font-weight: 500`, `lining-nums tabular-nums`).
- **Operator font route (`apps/local-owner/src/local-owner-server.ts`):** Served `GET /landing/fonts/*` via closed allow-list `LANDING_BINARY_ASSETS` (`nodeLandingAssetLoader()` instantiated lazily inside `createOwnerRequestHandler`) with `Content-Type: font/woff2`, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`.
- **Token parity (`test/shortlet-token-parity.test.ts`):** Switched from `xenia-kit.css` / `tokens.css` to `.scratch/app-expansion/design/round-12/tokens.json` (light & dark colour tokens, spacing, radius, font families).
- **Held-back tokens/copy:** None added; the 4 proposed issue 07 tokens remain unadded awaiting owner approval.
- **Owner note (AC2 / AC3):** The repo defines no explicit CLS budget; measured max CLS after self-hosting is `0.020286` (well under Google's `0.1` Good threshold). Ask owner to confirm whether to adopt a `0.05` or `0.1` CLS budget and accept the before/after delta below before merging.

### Slow-phone first render measurement (360×640, Lighthouse Fast 3G, cold origin per screen)

| Screen | Before FCP / Load | After FCP / Load | Before CLS | After CLS | After font transfer |
| --- | --- | --- | --- | --- | --- |
| Guest chat home (`/`) | 1708 ms / 4987 ms | 1744 ms / 5236 ms | 0 | 0.001261 | 48,924 B (2 WOFF2) |
| Search results (`/stays/search?...`) | 1668 ms / 1509 ms | 1632 ms / 2462 ms | 0 | 0.019695 | 48,924 B (2 WOFF2) |
| Unit detail (`/stays/unit-lagos-ikoyi-001?...`) | 1772 ms / 1639 ms | 1772 ms / 1497 ms | 0 | 0.002176 | 48,924 B (2 WOFF2) |
| Conditional Offer (`/conditional-offers/...`) | 1752 ms / 1680 ms | 1736 ms / 2544 ms | 0 | 0.001702 | 48,924 B (2 WOFF2) |
| Operator home (`/operator`) | 1572 ms / 1499 ms | 1572 ms / 2392 ms | 0 | 0.020286 | 48,924 B (2 WOFF2) |

### Verification, tests & captures

- **TDD red run:** `npx tsx --test test/shortlet-token-parity.test.ts test/self-hosted-type.test.ts` -> 5 passed, 4 failed (`AC1`, `AC2`, `AC4`, `AC5` in `test/self-hosted-type.test.ts`).
- **Build & check:** `npm run build && npm run check` -> 0 type errors, Worker bundle guard clean.
- **Unit & browser tests:** `npx tsx --test test/shortlet-token-parity.test.ts test/self-hosted-type.test.ts test/shortlet-ui-foundations.test.ts test/shortlet-design-system.test.ts test/guest-kit.test.ts test/cloudflare-static-assets.test.ts test/asset-loader.test.ts test/back-office-home.test.ts test/agent-mode-follows-task.test.ts` -> **51/51 passed** (1 skipped browser subtest in `shortlet-ui-foundations.test.ts` gated by `SHORTLET_FOUNDATIONS_BROWSER=1`).
- **Worker spec:** `npm run test:workers -- apps/cloudflare/test/landing-assets.spec.ts` -> **3/3 passed**.
- **Captures (`.scratch/guest-ui-consistency/screenshots/09/`):** 21 screen groups at 320, 390, 768, 1280 light & dark -> **0 horizontal overflow**, **0 actionable controls < 44px** (`payment-choice` reports expected `INPUT 1x1` for hidden native radio inputs inside 44px `.ui-segmented > label`).
