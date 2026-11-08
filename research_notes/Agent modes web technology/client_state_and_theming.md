# Client state, DOM preservation, navigation and theming for per-mode chat lanes (mobile, Nigeria), as of 2026-11-08

Scope: a vanilla TypeScript client on a server-rendered shell. Each agent mode has its own chat-history "lane" that the client caches and swaps instantly, and each mode has its own accent theme.

Source labels used below:
- **[verified]**: fetched or searched in this session.
- **[prior-knowledge, not re-fetched]**: taken from well-known canonical docs that I did not re-check this session. Confirm these before treating them as binding.

## 1. DOM preservation and swapping lanes: moveBefore, detached subtrees, content-visibility / hidden=until-found, memory, scroll restore, scroll anchoring

### Takeaway
Keep every lane as a live subtree inside one scroll container per lane. Hide inactive lanes with `hidden` (or `content-visibility: hidden` when keeping rendering state matters), and do not move nodes around. `moveBefore()` is still not Baseline because Safari lacks it, so it cannot be the main mechanism. Scroll anchoring (`overflow-anchor`) became Baseline Newly Available only on 2026-09-14 with Safari 27, so a fallback for older iOS is still needed.

### Cited Findings
- **`Element.moveBefore()` support [verified]:** Chrome and Chrome Android 133 (2025-02-04), Edge 133 (2025-02-06), Firefox and Firefox Android 144 (2025-10-14). Safari and iOS Safari: not supported (WebKit bug 281223). Status is "Limited availability", and Baseline has been blocked on Safari since Oct 2025 — [web-features explorer: move-before](https://web-platform-dx.github.io/web-features-explorer/features/move-before)
- **What `moveBefore()` does:** it moves a node without "remove + insert", so iframes, focus, running CSS animations/transitions and similar state survive. Detect it with `'moveBefore' in Element.prototype` and fall back to `insertBefore` — [Bram.us, Jan 2025](https://bram.us/2025/01/16/move-elements-around-the-dom-while-preserving-their-state-with-movebefore); [caniuse](https://caniuse.com/mdn-api_element_movebefore)
- **Some secondary pages still say Firefox lacks moveBefore.** That is outdated: the web-features data shows Firefox 144 — [caniuse wf-move-before](https://caniuse.com/wf-move-before) vs [web-features explorer](https://web-platform-dx.github.io/web-features-explorer/features/move-before)
- **`content-visibility` [verified]:** Baseline. Safari / iOS Safari 26 (2025-09-15) completed support — [web-features explorer: content-visibility](https://web-platform-dx.github.io/web-features-explorer/features/content-visibility)
- **`hidden="until-found"` [verified]:** Limited availability. iOS Safari is listed as unsupported (WebKit bug 238266), and caniuse sources conflict on partial support in Safari 26.2+ — [web-features explorer: hidden-until-found](https://web-platform-dx.github.io/web-features-explorer/features/hidden-until-found); [caniuse](https://caniuse.com/mdn-html_global_attributes_hidden_until-found)
- **`hidden="until-found"` semantics [prior-knowledge, not re-fetched]:** the content stays findable by find-in-page and fragment navigation, and the browser fires `beforematch` before revealing it. It uses `content-visibility: hidden` internally — [Chromium Intent to Ship](https://groups.google.com/a/chromium.org/g/Blink-dev/c/e8n8Z5dzMs0)
- **`overflow-anchor` / scroll anchoring [verified]:** Chrome 56, Edge 79, Firefox 66, Safari and iOS Safari 27 (2026-09-14). Baseline Newly Available 2026-09-14, projected Widely Available 2029-03-14 — [web-features explorer: overflow-anchor](https://web-platform-dx.github.io/web-features-explorer/features/overflow-anchor). Before Safari 27, WebKit had no scroll anchoring (bug open since 2017) — [WebKit bug 171099](https://bugs.webkit.org/show_bug.cgi?id=171099)
- **`content-visibility: hidden` vs `display: none` [prior-knowledge, not re-fetched]:** `content-visibility: hidden` skips painting and layout of the contents but keeps their rendering state, so re-showing is cheaper than `display: none`. It also preserves the scroll position of scroll containers inside it — [web.dev content-visibility](https://web.dev/articles/content-visibility); [MDN content-visibility](https://developer.mozilla.org/docs/Web/CSS/content-visibility)
- **Scroll position under `display: none` [prior-knowledge, not re-fetched]:** an element with `display: none` has no layout box. When it is shown again, its `scrollTop` is not reliably kept across browsers, so the app should store and restore it — [MDN content-visibility](https://developer.mozilla.org/docs/Web/CSS/content-visibility)
- **Pinned-to-bottom chat log with `column-reverse` [prior-knowledge, not re-fetched]:** `flex-direction: column-reverse` on the scroll container makes the scroll origin the bottom, so new messages stay in view without JS. The costs are reversed DOM order (or reversed visual order) for screen readers and keyboard focus, and historically inconsistent `scrollTop` sign conventions across engines. Spec-era behavior is negative `scrollTop` in Chrome 81+, Firefox and Safari — [MDN scrollTop](https://developer.mozilla.org/docs/Web/API/Element/scrollTop)

### Inferences
- **Recommended pattern.** Server-render (or client-build on first visit) one `<section data-lane="…">` per mode, each with its own `overflow-y: auto` log container. Toggle the inactive lanes with the `hidden` attribute or a class that applies `content-visibility: hidden`. Swapping becomes an attribute flip with no node movement, so `moveBefore()` is unnecessary. Avoid `hidden=until-found` for lanes: it lacks iOS support, and find-in-page revealing another mode's lane would be confusing.
- **Detached DOM fragments vs live hidden subtrees.** Holding detached `DocumentFragment`s or `Element`s in a JS `Map` works (state such as input values survives a `remove()`/`append()`). Re-insertion does reset iframe loads, focus and CSS animations. Live hidden subtrees avoid that and keep per-lane scroll containers intact under `content-visibility: hidden`.
- **Memory on low-RAM Android.** DOM nodes cost memory whether they are attached or detached. Cap rendered history per lane (for example, the last N ≈ 50–100 messages as DOM, with older ones as data, re-rendered on scroll-up) and cap the number of warm lanes (for example, the active lane plus the 2 most recent). On 2–3 GB Go-class devices (section 5), tab discards are common, so assume the page can be killed in the background and restored from cache.
- **Scroll restore per lane.** Store `{scrollTop, atBottom}` per lane on switch-away. On switch-back, if `atBottom` was true, scroll to bottom; otherwise restore the offset. With `content-visibility: hidden`, the browser may keep the offset itself, but writing it explicitly is safer.
- **Streaming tokens into a pinned-to-bottom log.** Use `overflow-anchor` (default `auto`) with a bottom sentinel element. For iOS < 27 (still a large installed base in late 2026), keep a JS "stick to bottom if the user was within X px of the bottom" fallback.

### Gaps
- I found no measured per-node memory cost for Chrome on Android Go devices. The memory guidance above is reasoning, not benchmark data.
- I could not confirm whether Safari has a public position on `moveBefore` beyond the open WebKit bug 281223.
- `column-reverse` accessibility and scroll quirks were not re-verified against 2026 engine behavior.

## 2. Navigation API, URL design and bfcache

### Takeaway
The Navigation API reached Baseline Newly Available on 2026-01-13, so `navigation.navigate()`, `intercept()` and per-entry `navigation.updateCurrentEntry({state})` can be used with a `history.pushState` fallback for older Safari/iOS. Put the active mode in the URL path or query, not only in `history.state`, so deep links, reloads and bfcache restores land in the right lane. For bfcache: avoid `unload` (Chrome no longer fires it as of Chrome 155), avoid `Cache-Control: no-store` on the shell, and close or pause long-lived connections on `pagehide`, reconnecting on `pageshow` with `event.persisted`.

### Cited Findings
- **Navigation API support [verified]:** Chrome and Edge 102, Safari 26.2 (2025-12-12, desktop and iOS), Firefox 147 (2026-01-13). Baseline Newly Available since 2026-01-13, projected Widely Available 2028-07-13 — [web-features explorer: navigation](https://web-platform-dx.github.io/web-features-explorer/features/navigation); [web.dev Baseline digest Jan 2026](https://web.dev/blog/baseline-digest-jan-2026); [InfoQ, May 2026](https://infoq.com/news/2026/05/navigation-api-browser)
- **unload is deprecated in Chrome [verified]:** Chrome's blog (dated 2026-10-16) says the unload deprecation is complete as of Chrome 155. By default, unload handlers no longer fire in Chrome and Chromium-based browsers. The gradual rollout began in March 2025, and one rollout table lists 100% on Chrome 154 (2026-09-22), so the exact version varies slightly between sources. Use `pagehide` instead — [Chrome blog: Unload event deprecated](https://developer.chrome.com/blog/unload-deprecated-in-chrome); [Deprecating the unload event](https://developer.chrome.com/docs/web-platform/deprecating-unload)
- **Cache-Control: no-store and bfcache [verified]:** Chrome allows bfcache for some `no-store` pages, only in Chrome:
  - The cache timeout drops to 3 minutes, versus 10 minutes for other pages.
  - The page is evicted if it fetches a `no-store` response or if cookies change.
  - An enterprise policy (`AllowBackForwardCacheForCacheControlNoStorePageEnabled`) can disable the behavior.
  - Other browsers may still refuse bfcache for `no-store` pages. The doc dates from Oct 2024 and was last updated Sep 2025, and I found no 2026 revision.

  — [Chrome: Enabling bfcache for Cache-Control: no-store](https://developer.chrome.com/docs/web-platform/bfcache-ccns)
- **General bfcache guidance [prior-knowledge, not re-fetched]:**
  - Common blockers are `unload` handlers, open `WebSocket`/WebRTC connections, an unfinished IndexedDB transaction, `window.opener` references and `Cache-Control: no-store`.
  - Chrome evicts a page if a held IndexedDB connection blocks a version change, or if a WebSocket is still open.
  - Recommended handling: close connections in `pagehide`, reopen in `pageshow` when `event.persisted === true`, and refresh stale data there.
  - Chrome's DevTools "Back/forward cache" panel and the `notRestoredReasons` API (`performance.getEntriesByType('navigation')[0].notRestoredReasons`) report why a page was not restored.

  — [web.dev bfcache](https://web.dev/articles/bfcache); [Chrome: notRestoredReasons](https://developer.chrome.com/docs/web-platform/bf-cache-notrestoredreasons)

### Inferences
- **URL shape.** Use a path segment (`/chat/<mode>`) when each mode is a top-level destination that should be shareable and bookmarkable and that the server-rendered shell can render directly (no-JS fallback). Use a query (`?mode=x`) when the mode is a filter on one canonical page. Keep scroll offsets, draft text and the "unread" flag in `navigation.currentEntry` state (or `history.state`), not in the URL.
- **Lane switching in history.** Switching modes should normally *replace* the entry (`navigation.navigate(url, {history: 'replace'})`), not push. Otherwise the Back button on Android steps through mode toggles instead of leaving the chat. Push only if the product treats modes as pages.
- **Feature-detect** with `'navigation' in window`. The fallback is `history.replaceState` plus `popstate`. Do not depend on `intercept()` for the server-rendered no-JS path.
- **Chat-specific bfcache handling:**
  - Close the SSE/WebSocket or abort the in-flight streaming `fetch` on `pagehide`.
  - On `pageshow` with `persisted`, re-sync the active lane, since its transcript may be stale, and re-check auth.
  - Serve the HTML shell with `Cache-Control: private, no-cache` rather than `no-store`, unless privacy rules force `no-store`. If they do, accept the shorter 3-minute Chrome window and no bfcache in other browsers.

### Gaps
- I did not confirm 2026 Safari/Firefox behavior for bfcache with `no-store`.
- I did not check whether Opera Mini (Nigerian share, section 5) runs the Navigation API at all. Opera Mini's "extreme" mode renders on Opera's servers and has very limited JS, so treat it as a no-JS client.

## 3. Theming: light-dark(), color-scheme, data-attribute tokens, style queries, @scope, cascade layers, contrast-color(), relative color, theme-color

### Takeaway
Every primitive needed for per-mode accent theming is Baseline by late 2026:
- `@scope`: Newly Available since 2025-12-09.
- Container style queries for custom properties: since 2026-05-19.
- `contrast-color()`: since April 2026.
- `light-dark()`, relative color syntax and cascade layers: earlier.

The simplest robust design sets `data-mode="x"` on the lane (or `<html>`), defines one `--accent` per mode, and derives the shades with `oklch(from var(--accent) …)`. `contrast-color()` with an `@supports` fallback gives the on-accent text color, and `light-dark()` handles dark mode. All these features are recent, so users on stale Android WebViews or iOS < 26 need static fallbacks.

### Cited Findings
- **Container style queries [verified]:** Firefox 151 shipped `@container style(--x: y)` for custom properties, making it Baseline Newly Available on 2026-05-19. Some third-party pages give conflicting earlier Firefox versions (122/128/138); treat those as unreliable — [web.dev New to the web platform in May 2026](https://web.dev/blog/web-platform-05-2026); [Mozilla intent to ship](https://groups.google.com/a/mozilla.org/g/dev-platform/c/WpRW4SetBL8); [web.dev Baseline digest May 2026](https://web.dev/blog/baseline-digest-may-2026)
- **Size container queries [verified]:** these are older and already Widely Available — [web-features explorer: container-queries](https://web-platform-dx.github.io/web-features-explorer/features/container-queries)
- **`@scope` [verified]:** Baseline Newly Available 2025-12-09 when Firefox 146 shipped it, joining Chrome and Safari. Projected Widely Available 2028-06-09 — [web-features explorer: scope](https://web-platform-dx.github.io/web-features-explorer/features/scope); [web.dev Dec 2025](https://web.dev/blog/web-platform-12-2025); [Frontend Masters](https://frontendmasters.com/blog/?p=8146)
- **`contrast-color()` [verified]:** Baseline Newly Available in April 2026 with Chrome 147. Firefox 146 and Safari 26 shipped it earlier, and sources disagree on the exact Firefox version. It returns a contrasting color aimed at WCAG AA minimum contrast, effectively black or white. Recommended fallback: a static `color` declaration, then `@supports (color: contrast-color(red))` — [web.dev New to the web platform in April 2026](https://web.dev/blog/web-platform-04-2026); [web.dev Dec 2025](https://web.dev/blog/web-platform-12-2025); [Smashing Magazine, May 2026](https://shop.smashingmagazine.com/2026/05/building-self-correcting-color-systems-contrast-color/)
- **`light-dark()` and `color-scheme` [prior-knowledge, not re-fetched]:**
  - `light-dark()` became Baseline in May 2024 (Chrome 123, Firefox 120, Safari 17.5).
  - It only works when `color-scheme: light dark` is set on the element or an ancestor.
  - As of the original spec it accepts only `<color>` values, not images or other types.

  — [MDN light-dark()](https://developer.mozilla.org/docs/Web/CSS/color_value/light-dark); [web.dev light-dark](https://web.dev/articles/light-dark)
- **Relative color syntax (`oklch(from var(--accent) calc(l + 0.1) c h)`) [prior-knowledge, not re-fetched]:** Baseline 2024 (Safari 18, Chrome 119, Firefox 128) — [MDN relative colors](https://developer.mozilla.org/docs/Web/CSS/CSS_colors/Relative_colors)
- **Cascade layers (`@layer`) [prior-knowledge, not re-fetched]:** Baseline since March 2022 — [MDN @layer](https://developer.mozilla.org/docs/Web/CSS/@layer)
- **`<meta name="theme-color">` [prior-knowledge, not re-fetched]:**
  - Chrome Android tints the browser UI with it. Safari 15+ supports it on iOS/macOS, and Safari 26 reportedly changed tinting behavior.
  - Firefox desktop does not support it.
  - It accepts a `media` attribute for light/dark variants.
  - JS can update its `content` at runtime to follow the active mode.

  — [MDN theme-color](https://developer.mozilla.org/docs/Web/HTML/Element/meta/name/theme-color)

### Inferences
- **Recommended token setup:**
  - Put `:root { color-scheme: light dark; }` on the root.
  - Base tokens use `light-dark()`.
  - Each mode gets `[data-mode="concierge"] { --accent: oklch(…); }` and so on.
  - Derive the shades: `--accent-strong: oklch(from var(--accent) calc(l - .12) c h)` and `--accent-soft: oklch(from var(--accent) .95 calc(c * .3) h)`.
  - `--on-accent: contrast-color(var(--accent))`, with a precomputed static fallback per mode.
- **Validate contrast at build time.** `contrast-color()` chooses black or white only, and the WCAG check should not depend on runtime support.
- **Attribute selectors vs style queries.** A plain attribute selector (`[data-mode=x]`) is sufficient and has the widest support. Container style queries help only when a component must react to an inherited custom property without an attribute hook. Given their 2026-05 Baseline date, keep them as progressive enhancement.
- **`@scope` per lane.** `@scope ([data-lane]) to ([data-lane])` limits lane styles without BEM-style prefixes. A lower-risk alternative is `@layer tokens, base, kit, mode;` with mode overrides in the last layer.
- **Swap the accent by flipping one attribute.** Avoid transitions on many custom properties, which are expensive on low-end CPUs. Update `theme-color` in the same frame.
- **Older-browser fallbacks.** Users on iOS < 26 or old Android WebViews (in-app browsers) need fallbacks: a static `--on-accent` per mode, and hex/oklch values precomputed at build time where relative color syntax is unsupported (iOS < 18).

### Gaps
- I did not re-verify the exact versions for `light-dark()` and relative color syntax in this session.
- I found no data on the share of Nigerian Android users on stale WebView versions, for example in-app browsers in WhatsApp, Instagram or Opera.

## 4. Client caching for per-lane transcripts: memory vs IndexedDB / Cache API / service worker; privacy; eviction

### Takeaway
Keep lane transcripts in memory (a `Map<mode, LaneState>`) for instant swaps. Optionally persist a short, recent window per lane in IndexedDB (not the Cache API, which is meant for request/response pairs) so lanes survive tab discards. Treat the server as the source of truth. On shared or low-end devices, cache only non-sensitive content, keyed to the signed-in guest, and clear it on logout. Best-effort storage can be evicted at any time, so design every read to tolerate a miss.

### Cited Findings
These are all [prior-knowledge, not re-fetched]:
- **Storage is "best-effort" by default.** Browsers can evict an origin's data under storage pressure (least-recently-used origin first). `navigator.storage.persist()` requests persistent storage, and Chrome grants it based on heuristics such as engagement or an installed PWA. `navigator.storage.estimate()` reports usage and quota — [MDN Storage quotas and eviction criteria](https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); [web.dev storage for the web](https://web.dev/articles/storage-for-the-web)
- **Safari deletes script-writable storage after 7 days without user interaction** for sites not installed to the Home Screen (ITP). This covers IndexedDB, localStorage and service worker registrations — [WebKit blog: Full Third-Party Cookie Blocking and More (2020)](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/). This is older data: check current WebKit policy.
- **IndexedDB is the recommended store for structured app data.** The Cache API is for network request/response pairs. localStorage is synchronous and blocks the main thread — [web.dev storage for the web](https://web.dev/articles/storage-for-the-web)

### Inferences
- **Tiers:**
  1. In memory: the active lane plus warm lanes. This is the instant swap.
  2. IndexedDB: the last N messages and the scroll state per lane, written debounced and on `visibilitychange`→hidden or `pagehide`. Do not keep the transaction open, or bfcache can be blocked.
  3. Server: the authoritative transcript, re-synced on lane activate and on `pageshow`.
- **Service worker.** It is useful for caching the app shell (CSS/JS) on slow, expensive networks (section 5). It is not needed for transcripts. Do not cache personalized API responses in the Cache API.
- **Privacy on shared devices** (common in Nigeria: family phones, shared tablets):
  - Do not persist contact details, payment links or booking tokens client-side.
  - Key stored data by guest/session id, clear it on sign-out and session expiry, and offer an explicit "clear this device".
  - In-memory-only is the most private option. IndexedDB survives closing the browser.
- **Eviction is expected on Android Go devices**, which have little free storage, and on iOS (7-day cap). Every cache read must fall back to a server fetch, and the UI must not assume a cached lane exists.

### Gaps
- No source fetched this session. All findings in this section are [prior-knowledge, not re-fetched].
- I did not verify any 2026 changes to Safari's 7-day storage cap or Chrome's quota heuristics.
- I found no Nigeria-specific data on how often devices are shared.

## 5. Nigerian mobile context: browsers, devices, networks, data costs, budgets

### Takeaway
Plan for the following:
- **Browsers:** Chrome on Android is about 60–64%. Opera is about 20%, a share unusually high for Nigeria, and some of it is Opera Mini with very limited JS. Safari/iOS is about 13%.
- **Devices:** mostly sub-$200 phones, many with 2–3 GB RAM including Android Go editions.
- **Network:** a national median of about 44 Mbps on mobile download, with large variance.
- **Data cost:** data became much more expensive after the Jan–Feb 2025 tariff hikes.

Per Alex Russell's global P75 budget, keep JS to about ≤300–350 KiB gzipped in total, and much less for the chat shell. The server-rendered shell must stay usable without JS.

### Cited Findings
- **Browser share, StatCounter Nigeria, mobile, July 2026 [verified]:** Chrome 64.23%, Opera 19.87%, Safari 12.77%, Samsung Internet / UC / Firefox about 1% or less each. June 2026 was similar: Chrome 64.5%, Opera 19.74%, Safari 12.68% — [StatCounter Nigeria mobile](https://gs.statcounter.com/browser-market-share/mobile/nigeria)
- **Browser versions, June 2026 [verified]:** Chrome for Android 59.86%, Safari iPhone 12.7%, Opera 99.2 about 5.7% (with several Opera 99.x versions in addition) — [StatCounter Nigeria mobile versions](https://gs.statcounter.com/browser-version-market-share/mobile/nigeria). StatCounter measures page-view share on sites that run its tracker, not users.
- **Mobile network speed [verified]:**
  - Ookla Speedtest Global Index put Nigeria's median mobile download at 44.14 Mbps (Dec 2025), ranked 85th globally.
  - DataReportal Digital 2026 gives 44.96 Mbps and notes +24.77 Mbps (+123%) in the 12 months to Aug 2025.
  - An earlier Ookla urban/rural split: urban (Lagos, Abuja) 35.52 Mbps vs rural 27.67 Mbps. This is older data.

  — [BusinessDay](https://businessday.ng/technology/article/nigeria-slips-to-85th-in-global-internet-speed-rankings-as-peers-pull-ahead/); [DataReportal Digital 2026 Nigeria](https://datareportal.com/reports/digital-2026-nigeria); [BusinessDay: speeds double](https://businessday.ng/technology/article/nigerias-mobile-speeds-double-in-two-years-as-4g-expansion-offsets-data-surge/)
- **Fixed broadband [verified]:** median 34.47 Mbps in H1 2026, up from 13.50 Mbps in 2023 — [Nairametrics, Aug 2026](https://nairametrics.com/2026/08/17/nigerias-broadband-speed-jumps-155-as-fibre-connections-triple/)
- **Connections and offline population [verified]:** 147.52 M mobile internet connections (Dec 2025, GSMA), yet nearly 6 in 10 Nigerians remain offline — [Legit.ng](https://www.legit.ng/business-economy/technology/1698983-nigerias-smartphone-boom-risk-sharp-shipment-decline-soaring-costs-2026/); [Guardian NG](https://guardian.ng/?p=2837786)
- **Data costs [verified]:**
  - The NCC approved a 50% tariff rise in Jan 2025, raising the 1 GB floor from ₦287.50 to ₦431.25 (effective about Jan 20).
  - BusinessDay found the average 1 GB price across operators rose about 65%, to about ₦475. Airtel went from ₦350 to ₦500, MTN from ₦200 to ₦350, and Glo from ₦300 to ₦750.
  - MTN's weekly 15 GB bundle went from ₦2,000 to ₦6,000.
  - Before the hike, ITU/GSMA cited about $0.39 per GB, the cheapest in West Africa.
  - Nigerians spend about ₦721 bn per month on data (Sep 2025).
  - These are early-2025 prices. I found no confirmed 2026 price.

  — [The Condia](https://thecondia.com/mtn-nigeria-data-price-hike-2025/); [The Star / BBC report](https://www.the-star.co.ke/news/africa/2025-02-11-huge-data-price-hike-sparks-anger-in-nigeria); [Nairametrics comparison](https://nairametrics.com/2025/01/14/tariff-increase-cost-of-data-in-nigeria-ghana-south-africa-and-kenya-compared/); [Techeconomy](https://techeconomy.ng/itu-gsma-cost-of-mobile-data-in-nigeria-lowest-in-west-africa/); [TechCabal](https://techcabal.com/2025/09/01/nigeria-data-spend-721bn-monthly/); [Leadership: users cut data use](https://leadership.ng/higher-tariff-forces-many-nigerians-to-reduce-data-usage)
- **Devices [verified]:**
  - Omdia counted 84.4 M smartphones shipped in Africa in 2025 (+13% YoY), and 4 in 5 cost under $200. Nigerian buyers cluster in the most price-sensitive segment.
  - Omdia forecasts African shipments may fall nearly 25% in 2026 as component costs rise.
  - Nairametrics' Oct 2025 list of affordable 4G phones in Nigeria includes 2 GB and 3 GB RAM models, some of them Android Go editions. This is a retail listing, not market share.
  - Nigeria is a GSMA Handset Affordability Coalition pilot country.

  — [TechCabal, Feb 2026](https://techcabal.com/2026/02/25/in-2025-four-in-five-smartphones-sold-in-africa-cost-under-200/); [Legit.ng](https://www.legit.ng/business-economy/technology/1698983-nigerias-smartphone-boom-risk-sharp-shipment-decline-soaring-costs-2026/); [Nairametrics affordable phones](https://nairametrics.com/2025/11/01/top-10-most-affordable-4g-smartphones-in-nigeria-as-of-october-2025/); [Engineering News](https://www.engineeringnews.co.za/article/six-countries-in-africa-eyed-for-affordable-smartphone-pilot-2026-03-09)
- **Performance budget [partly verified]:** Alex Russell's "Performance Inequality Gap" series sets a budget for the global P75 device and network. The 2023/2024 editions give about 150 KiB of HTML/CSS/fonts and about 300–350 KiB of gzipped JS. Secondary summaries say the 2026 edition keeps the same JS figure and notes that mobile JS payloads have doubled since 2015, with fewer than half of origins passing mobile CWV. The 2026 numbers come from secondary digests, not from the primary post — [Infrequently Noted](https://infrequently.org/2022/12/); [Performance Inequality Gap 2024 (summary)](https://conffab.com/elsewhere/the-performance-inequality-gap-2024-infrequently-noted/); [RedMonk interview, Nov 2025](https://redmonk.com/blog/2025/11/24/alex-russell/)

### Inferences
- **Browser support baseline.** Chrome Android (evergreen) covers most traffic, so Chromium-only features are reachable for about 60%+ of users. That share rises to about 80% if Opera for Android is a recent Chromium (Opera 99.x versions suggest it is).
- **iOS is about 13% and gates Baseline features.** `moveBefore` (unsupported), `overflow-anchor` (iOS 27 only) and Navigation API (iOS 26.2+) all need fallbacks.
- **Opera Mini extreme mode** (some share of the 20%) means the server-rendered shell must be complete without JS. The project already has a `/conversation` no-JS fallback.
- **Budgets for the chat shell:**
  - Initial JS: tens of KiB gzipped, well under Russell's ceiling.
  - CSS for all mode themes: one file, with mode accents as about 3 custom properties each, not per-mode stylesheets.
  - No web fonts, or one subset font.
  - Lazy-load each lane's transcript only when first activated.
- **Data cost argues against prefetching every lane.** Fetch the inactive lanes on first visit to each, then keep them. A service worker shell cache saves repeat downloads.
- **The 44 Mbps median hides high latency and variability.** Design for slow-3G/flaky conditions in testing (Chrome DevTools throttling), since rural and congested urban cells are well below the median.

### Gaps
- No primary 2026 Ookla Nigeria mobile median beyond the Dec 2025 index figure.
- No Opensignal 2026 Nigeria data retrieved.
- No source splitting Opera Mini from Opera for Android in Nigeria.
- No market data on the RAM distribution or Android Go share of the Nigerian installed base.
- No 2026 data-price figures after the 2025 hike.
- The primary Infrequently Noted 2025/2026 post was not fetched.
