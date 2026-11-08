# Agent switcher: web platform interaction primitives and accessibility (as of 2026-11-08)

Context: mobile chat web app. The guest cycles agent modes by swiping a strip of agent icons, tapping, or using the keyboard. Mid-conversation, an app-bar icon opens a bottom sheet. Audience: Nigeria, low-end Android, mostly Chrome. Vanilla TypeScript client. Must keep a no-JS fallback.

Confidence key: **[V]** checked in a source fetched this session. **[S]** search-result summary only (secondary, not opened). **[K]** stable spec text cited from prior knowledge, not re-fetched this session.

## 1. Scroll snap, snap events, scrollend, scroll-state queries, CSS carousel primitives

### Takeaway
The safe base is CSS scroll snap plus `scrollend`. Both work in every engine (`scrollend` reached Safari in 26.2, December 2025). The rest is Chromium-only progressive enhancement: `scrollsnapchange`/`scrollsnapchanging` (Chrome 129), `@container scroll-state()` (Chrome 133) and the CSS carousel pseudo-elements (Chrome 135). Don't use the carousel pseudo-elements as the agent selector's semantics: Chrome exposes markers as tabs in a tablist, and experts have documented semantic and state mismatches.

### Cited Findings
- **Scroll snap events (`scrollsnapchange`, `scrollsnapchanging`):**
  - Chrome 129, Chrome Android 129 (2024-09-17) and Edge 129. **[V]**
  - Not supported in Firefox, Firefox Android, Safari or Safari iOS. **[V]**
  - Baseline status: "Limited availability". **[V]**
  - Sources: [web-features explorer: scroll-snap-events](https://web-platform-dx.github.io/web-features-explorer/features/scroll-snap-events/); [Chrome blog: Scroll Snap Events](https://developer.chrome.com/blog/scroll-snap-events)
- **`scrollend` event:**
  - Chrome/Edge 114, Firefox 109, Safari 26.2 (December 2025), so it is now cross-browser Baseline. **[S]**
  - Feature-detect with `'onscrollend' in window`, with a timer or polyfill fallback (for example scrollyfills). **[S]**
  - Sources: [InfoQ, 2026-04: Safari scrollend support](https://www.infoq.com/news/2026/04/safari-scrollend-support); [Chrome blog: scrollend](https://developer.chrome.com/blog/scrollend-a-new-javascript-event)
- **Container scroll-state queries (`snapped`, `stuck`, `scrollable`):**
  - Chrome 133. **[S]**
  - Not supported in Firefox (bug 1931980; caniuse shows the `snapped` query unsupported through Firefox 150). **[S]**
  - Not supported in Safari. **[S]**
  - Sources: [web-features explorer: container-scroll-state-queries](https://web-platform-dx.github.io/web-features-explorer/features/container-scroll-state-queries); [caniuse: scroll-state snapped](https://caniuse.com/mdn-css_at-rules_container_scroll-state_queries_snapped); [Chrome blog: CSS scroll-state queries](https://developer.chrome.com/blog/css-scroll-state-queries)
- **CSS carousel primitives (`::scroll-marker`, `::scroll-marker-group`; CSS Overflow 5):**
  - Chrome, Chrome Android and Edge 135 (April 2025). **[V]**
  - Not supported in Firefox (bug 2073202), Firefox Android, Safari or Safari iOS. **[V]**
  - Baseline status: "Limited availability". **[V]**
  - Sources: [web-features explorer: scroll-markers](https://web-platform-dx.github.io/web-features-explorer/features/scroll-markers/); [Chrome blog: accessible carousel (2025-09-29)](https://developer.chrome.com/blog/accessible-carousel)
- **Chrome accessibility fixes since launch:**
  - A disabled `::scroll-button` is now read correctly by screen readers. **[V]**
  - Markers now take their accessible name from `content`. **[V]**
  - Fixed a bug where every marker was announced as "selected". **[V]**
  - Counters in alt text landed in Chrome 140. **[V]**
  - Automatic roles for `::scroll-marker-group` are still "planned", so authors set roles manually. **[V]**
  - Source: [Chrome blog: accessible carousel](https://developer.chrome.com/blog/accessible-carousel)
- **Chrome's recommended carousel markup:**
  - Discrete pages: a `role="region"` container with a single `role="tabpanel"` that updates. Don't use `aria-live="polite"` there, because slow scrolling triggers noisy announcements. **[V]**
  - List content: use a `<ul>` so screen readers announce the item count. **[V]**
  - Don't use `interactivity: inert` on off-screen items, because that removes them from the accessibility tree. **[V]**
  - Source: [Chrome blog: accessible carousel](https://developer.chrome.com/blog/accessible-carousel)
- **Scroll button distance:** `::scroll-button()` scrolls about 85% of the scrollport, not to the next snap target. A December 2025 CSSWG thread reports buttons leave the target partly visible while markers land on the snap position. **[S]** Source: [public-css-archive 2025-12](https://lists.w3.org/Archives/Public/public-css-archive/2025Dec/0384.html)
- **Expert audit (Sara Soueidan, May 2025, updated Aug 2025):**
  - Markers are always exposed as `tab`s in a `tablist`, whatever the pattern. Most demos have no `tabpanel`s, so the tabs control nothing. **[V]**
  - The tablist is single-select even when several items are visible. **[V]**
  - Names come from CSS `content`, and some demos give every marker the same name. **[V]**
  - A disabled scroll button stayed focusable. **[V]**
  - The generated group skews the list item count. **[V]**
  - Focus moves unpredictably into off-screen cards. **[V]**
  - `:target-current` didn't work with native links at the time; a `scroll-target-group` property was proposed. **[V]**
  - Recommendation: "Semantics should be defined in HTML." **[V]**
  - Source: [Sara Soueidan: Are CSS Carousels accessible?](https://sarasoueidan.com/blog/css-carousels-accessibility)
- **Firefox:** one secondary source says Firefox has partial, flag-only carousel support, checked against Firefox 130. This is likely outdated. **[S]** Source: [SitePoint 2026](https://www.sitepoint.com/scrolldriven-css-in-2026-building-carousels-without-javascript/)

### Inferences
- **Recommended strip:**
  - A horizontal `overflow-x: auto; scroll-snap-type: x mandatory` container of real controls (radios or buttons, see section 3), each with `scroll-snap-align: center`. This works with no JS in every engine.
  - Use `scrollend` (all engines) to commit the snapped agent after a swipe, and compute the centred item yourself.
  - Use `scrollsnapchange` as a Chromium-only nicety, for example for an earlier commit or richer state. Low-end Android Chrome is covered, but feature-detect it.
- **Don't commit a mode change on `scrollsnapchanging`.** It fires mid-gesture. Use it only for a visual preview. Committing a whole-conversation mode switch on every intermediate snap would spam announcements and network calls.
- **Use `@container scroll-state(snapped: x)` only for decoration** (enlarging the centred icon). Without it, the strip must still show which agent is selected through the checked or selected state (`:checked` / `[aria-pressed]` / `[aria-checked]`).
- **Avoid `::scroll-marker`/`::scroll-button` for the agent switcher.** They are Chromium-only, carry tablist semantics you can't control, and are generated content that can't be a no-JS form control. Real HTML controls are more robust.

### Gaps
- Exact WebKit and Gecko shipping plans for scroll snap events and scroll-state queries in late 2026 (for example, whether they are Interop 2026 focus areas) were not confirmed.
- Whether Chrome now auto-assigns roles to `::scroll-marker-group`, or ships `scroll-target-group` (and in which version), was not confirmed after September 2025.
- The current Chrome support version for `:target-current` was not confirmed.

## 2. Popover API, `popover="hint"`, invoker commands, `interestfor`, `<dialog closedby>`, bottom sheets, anchor positioning

### Takeaway
For the bottom sheet, use a `<dialog>` opened with invoker commands (`<button commandfor="agents" command="show-modal">`). That needs no JS in Chrome 135+, Firefox 144+ and Safari 26.2+ (sources mostly agree; verify Safari). On Android the back gesture already closes a modal dialog through CloseWatcher (Chrome 120+). `closedby="any"` (light dismiss) works in Chrome 134+ and Firefox 141+, but not Safari. `interestfor` is Chromium-only and opposed by WebKit, so don't depend on it, least of all on touch. Anchor positioning is Baseline but only partial on iOS 26. A bottom sheet doesn't need it.

### Cited Findings
- **Popover API:** listed by MDN as "Baseline 2025". **[S]** Source: [MDN Popover API](https://developer.mozilla.org/docs/Web/API/Popover_API)
- **`popover="hint"`:**
  - Firefox's intent-to-ship (February 2026) targets Firefox 149 (24 March 2026) and mentions an Interop 2026 proposal. Whether it actually shipped is not confirmed. **[S]**
  - The popover polyfill can't polyfill `hint` in browsers that support popover but not `hint`. **[S]**
  - Sources: [Mozilla dev-platform: Intent to Ship popover=hint](https://groups.google.com/a/mozilla.org/g/dev-platform/c/OGdRzK18_Zo); [OddBird polyfill updates](https://oddbird.net/2025/05/06/polyfill-updates); [Chrome guidance: interest-triggered tooltips](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/interest-triggered-tooltips)
- **Invoker commands (`commandfor`/`command`, `<button>` only):**
  - Firefox 144 (2025-10-14); caniuse shows 144–151 supported. **[S]**
  - Safari 26.2 (December 2025), which reportedly made the feature Baseline. **[S]**
  - Conflict: the web-features explorer still showed Safari blocking (stale snapshot). **[S]**
  - Built-in commands include `show-modal`, `close`, `request-close`, `toggle-popover`, `show-popover` and `hide-popover`.
  - Sources: [caniuse: invoker commands](https://caniuse.com/wf-invoker-commands); [web-features explorer: invoker-commands](https://web-platform-dx.github.io/web-features-explorer/features/invoker-commands/); [Paweł Grzybek: more invoker commands](https://pawelgrzybek.com/more-invoker-commands-and-more-reasons-not-to-use-javascript-please)
- **Interest invokers (`interestfor` on `<button>`/`<a>`):**
  - Shipped in Chrome 142 (2025-10-28). **[S]**
  - Not supported in Firefox or Safari. WebKit is publicly opposed ("We therefore remain opposed to this feature", quoted on blink-dev). **[S]**
  - Sources: [Chrome 142 release notes](https://developer.chrome.com/release-notes/142); [caniuse: interest invokers](https://caniuse.com/wf-interest-invokers); [blink-dev Intent to Ship: Interest Invokers](https://groups.google.com/a/chromium.org/g/blink-dev/c/bX1G_yDt6W4); [MDN: Using interest invokers](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using_interest_invokers)
- **`<dialog closedby>` (`any` / `closerequest` / `none`):**
  - Chrome 134 (2025-03-04), Edge 134 and Firefox 141 (2025-07-22). **[S]**
  - Safari and iOS Safari are unsupported (WebKit bug 284592; the WebKit vendor position is "support"), so Baseline has been blocked by Safari since July 2025. **[S]**
  - Fallback: a click listener that checks whether the click landed outside the dialog's box. **[S]**
  - Sources: [web-features explorer: dialog-closedby](https://web-platform-dx.github.io/web-features-explorer/features/dialog-closedby); [WebKit bug 284592](https://bugs.webkit.org/show_bug.cgi?id=284592); [Chrome guidance: light-dismiss a dialog](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/light-dismiss-a-dialog)
- **Android back button / close requests:**
  - Chrome 120 introduced CloseWatcher and made `<dialog>` and `popover` respond to the Android back gesture. **[S]**
  - The design prevents "back-trapping": with no user activation between opening and the close request, the `cancel` event can be skipped, or several watchers can close at once. **[S]**
  - Firefox has added Android back-button closing for dialogs and popovers plus CloseWatcher (bug 1966073, closed about two months before the search). **[S]**
  - Sources: [Chrome 120 blog](https://developer.chrome.com/blog/new-in-chrome-120); [blink-dev Intent to Ship: close requests](https://groups.google.com/a/chromium.org/g/blink-dev/c/jM5au7yYzHM); [Mozilla bug 1966073](https://bugzilla.mozilla.org/show_bug.cgi?id=1966073)
- **CSS anchor positioning:**
  - Safari 26 (September 2025) and Firefox 147 (January 2026), which made it "Baseline Newly available". **[S]**
  - Caniuse shows iOS Safari 26.0–26.6 as partial and 27.0 as full. **[S]**
  - Sources: [web.dev: New to the web platform in January 2026](https://web.dev/blog/web-platform-01-2026); [caniuse: CSS anchor positioning](https://caniuse.com/css-anchor-positioning)

### Inferences
- **Bottom sheet recipe:**
  - `<dialog id="agents" closedby="any">` styled as a sheet: `position: fixed; inset: auto 0 0 0; margin: 0; max-height: 85dvh;` animated with `@starting-style` plus `transition-behavior: allow-discrete`.
  - Opened by `<button commandfor="agents" command="show-modal" aria-label="Switch agent">` in the app bar.
  - Use a modal dialog (focus trap, inert background, Esc and Android back close it) rather than a popover. Agent choice is a focused task.
- **Drag to dismiss:**
  - Build it as JS progressive enhancement, using pointer events on a grab handle with `touch-action: none` on the handle only.
  - Always also give a visible Close button (`command="close"`) for WCAG 2.5.7 (section 3).
  - An alternative low-JS trick: make the sheet a vertical scroll-snap container with a transparent top "dismiss" snap point, and close it on `scrollend`/`scrollsnapchange` when it snaps there. Treat this as an inference; I didn't verify it in a source.
- **Back button and history:**
  - Don't `pushState` for the sheet. Chrome and Firefox already map Android back to closing the dialog through CloseWatcher.
  - Adding history entries risks double-handling and anti-back-trapping skips.
  - On iOS, which has no back button, Esc doesn't apply; rely on the Close button and the backdrop.
- **No-JS fallback:** a plain link to a server-rendered agent-picker page (a `<form>` of radios submitting by GET or POST). Invoker commands then progressively upgrade it to an in-page dialog. Old browsers without `commandfor` need either the link or a tiny `showModal()` shim, detected with `'command' in HTMLButtonElement.prototype`.
- **Skip `interestfor` and `popover="hint"` here.** A touch-first audience gets no hover, and tooltips on agent icons should be replaced by visible text labels.

### Gaps
- Exact Chrome version that added invoker commands (Chrome 135 from prior knowledge; not re-verified) and the exact Safari version (26.2 per secondary sources; check MDN or webstatus.dev).
- Whether `popover="hint"` actually shipped in Firefox 149, and its Safari status.
- Whether `closedby` shipped in Safari 26.x/27 after the snapshots seen (caniuse lists Safari up to 27.2 in other tables).
- Whether iOS Safari has any back-gesture-to-close behaviour for `<dialog>`; no source found.

## 3. ARIA pattern for choosing one agent; keyboard; announcements; WCAG 2.5.x

### Takeaway
The agent strip is a single-choice control that changes the conversation mode. That is semantically a **radio group**, best built from native `<input type="radio">` inside a `<fieldset>`/`<form>`: it works without JS and has free arrow-key roving and selection-follows-focus. Use `tablist` only if each agent truly reveals its own panel (a separate conversation view), and then use manual activation when switching has latency (a network or model call). Don't use `listbox` or `menu`. Announce the change with a polite status message. Swipe must have a tap or button alternative (WCAG 2.5.1), drag-to-dismiss needs a Close button (2.5.7), and targets must be at least 24x24 CSS px (2.5.8 AA). The project's own rule is 44px (ADR 0078).

### Cited Findings
- **APG Radio Group:**
  - Arrow keys move focus and check the radio together ("selection follows focus"), using a roving tabindex. **[S]**
  - Only one radio is in the Tab sequence: the checked one, or the first if none is checked. **[S]**
  - Space checks the focused radio. **[S]**
  - Source: [APG Radio Group example (roving tabindex)](https://w3.org/WAI/ARIA/apg/patterns/radio/examples/radio)
- **APG Tabs:**
  - APG recommends automatic activation only "as long as their associated tab panels are displayed without noticeable latency". Otherwise use manual activation, where Enter/Space activates. **[V]**
  - It warns that latency during automatic activation "significantly hampers users' ability to navigate efficiently". **[V]**
  - Left and Right Arrow move between tabs and wrap at the ends; Home and End are optional. **[V]**
  - Required: `tablist`/`tab`/`tabpanel`, `aria-selected`, `aria-controls` on each tab, and `aria-labelledby` on each panel. **[V]**
  - Source: [APG Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- **APG general rule for single-select widgets:** when selection-follows-focus isn't appropriate, users change selection explicitly with Enter or Space. **[S]** Source: [APG keyboard interface practice (via APG patterns examples)](https://apg-patterns-examples.pages.dev/practices/keyboard-interface)
- **Platform focusgroup:** an Open UI / Edge `focusgroup` explainer proposes declarative arrow-key roving. Its status is not confirmed. **[S]** Sources: [Focusgroup explainer](https://www.Github.com/hpsin/MSEdgeExplainers/blob/main/Focusgroup/explainer.md); [Open UI issue 1018](https://github.com/openui/open-ui/issues/1018)
- **WCAG 2.5.8 Target Size (Minimum), Level AA:**
  - "The size of the target for pointer inputs is at least 24 by 24 CSS pixels, except when..." **[V]**
  - Spacing exception: a 24 CSS px diameter circle centred on each undersized target must not intersect another target or another undersized target's circle. **[V]**
  - Other exceptions: an equivalent control on the page, inline text, an unmodified user-agent control, or an essential or legally required presentation. **[V]**
  - Source: [Understanding SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- **WCAG 2.5.1 Pointer Gestures (A):** functionality that uses multipoint or path-based gestures must also work with a single pointer without a path-based gesture, unless the gesture is essential. A swipe is path-based. **[K]** Source: [Understanding SC 2.5.1](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html)
- **WCAG 2.5.7 Dragging Movements (AA):** functionality that uses dragging must also work with a single pointer without dragging, unless dragging is essential. This applies to drag-to-dismiss. **[K]** Source: [Understanding SC 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
- **WCAG 4.1.3 Status Messages (AA):** status messages must be programmatically determinable through role or properties, so assistive technology can present them without receiving focus. Typical implementation: `role="status"`, which is implicitly `aria-live="polite"`. **[K]** Source: [Understanding SC 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- **Live regions during scrolling:** Chrome advises against `aria-live="polite"` on carousel panels, because slow scrolling causes noisy announcements. **[V]** Source: [Chrome blog: accessible carousel](https://developer.chrome.com/blog/accessible-carousel)

### Inferences
- **Recommended markup (works with no JS):** a `<form method="get" action="/">` holding `<fieldset><legend>Agent</legend>`, with one `<label><input type="radio" name="agent" value="...">Icon + visible name</label>` per agent, plus a `<noscript>` or always-present "Switch" submit button. With JS, auto-commit on `change`.
  - Native radios already give the arrow-key roving and selection-follows-focus behaviour the APG model describes, with no custom tabindex code.
  - Keep visible text names (not icon-only), or at least an accessible name per radio.
- **Why not `tablist`:** the switch changes the conversation's mode and likely triggers a network or model call (latency). Under APG Tabs that means manual activation and a full tab/tabpanel wiring.
  - Selecting an agent doesn't reveal a static panel; it changes system behaviour. A radio group (a choice among options) maps better.
  - `menu`/`menubar` is for application command menus, and `listbox` is for picking items from a list (usually data). Neither fits as well.
  - These are design inferences; APG gives no explicit "mode switcher" guidance.
- **Arrow keys and network calls:** because radios select on arrow key, debounce the commit (for example, wait for the selection to rest about 500 ms, or commit on `scrollend` for swipes). Alternatively, make the strip a *preview* and commit with an explicit control. This avoids firing model calls for every intermediate agent.
- **Announce the change once:** after the commit, put text such as "Switched to Booking agent" into one persistent `role="status"` region outside the scroller. Don't put a live region on the strip itself. If the conversation view is replaced, keep focus on the selected radio (don't move it into the thread), unless the new agent posts a greeting, which a log region (`role="log"`) on the thread can announce.
- **Swipe alternatives:** tap on any icon (single pointer, no path) satisfies 2.5.1. Optional previous/next buttons help switch-access and one-handed users. In the bottom sheet, every agent is a tappable radio, so no dragging is ever required (2.5.7).
- **Target size:** the project's own rule (ADR 0078) is 44px, which is stricter than 2.5.8's 24px AA floor. Make each label 44px or more tall and wide. With hidden native radios, the label is the target (AGENTS.md notes hidden radios report 1x1).

### Gaps
- APG Radio Group page text was not fetched directly; details come from search summaries of the APG example.
- No expert-blog source (Adrian Roselli, Scott O'Hara) was found on "radio vs tabs for mode switchers". This needs a targeted follow-up if the writer wants a citation.
- `focusgroup` shipping status in Chromium as of late 2026 is unknown.

## 4. Gesture conflicts on mobile (horizontal swipe vs system back; overscroll-behavior; touch-action)

### Takeaway
On Chrome Android and Firefox, `overscroll-behavior-x: contain` (or `none`) on the strip stops scroll chaining and overscroll history navigation. The Android OS edge-swipe back gesture is handled by the system and can't be blocked by a page; it maps to a close request, which closes an open dialog. On iOS Safari the edge-swipe back can't be disabled by CSS. Keep the strip away from the screen edges, and keep pan gestures native (`touch-action: pan-x`) rather than custom.

### Cited Findings
- **`overscroll-behavior`:**
  - `contain` stops scroll chaining to ancestors. `none` also suppresses the element's own overscroll effects (Android glow, iOS rubber-band). **[S]**
  - Chrome's guidance uses `overscroll-behavior-x` for horizontal swipe areas. **[S]**
  - Source: [Chrome blog: overscroll-behavior](https://developer.chrome.com/blog/overscroll-behavior)
- **Preventing history navigation:** `overscroll-behavior-x` on a horizontal scroller prevents swipe-to-navigate history in Chrome and Firefox. A WebKit bug notes macOS Safari doesn't honour it for trackpad back/forward. **[S]** Sources: [Dan Burzo: prevent history navigation on horizontally scrolling elements](https://dev.to/danburzo/css-micro-tip-prevent-history-navigation-on-horizontally-scrolling-elements-3iil); [WebKit bug 240183](https://www2.webkit.org/show_bug.cgi?id=240183)
- **iOS Safari edge swipe:** older Stack Overflow answers say the CSS doesn't stop iOS's swipe-back, and there's no way to disable it (only history-hack workarounds). This is old; current behaviour is unverified. **[S]** Source: [archived StackOverflow 55574478](https://kaweah.freedombox.rocks/kiwix/content/stackoverflow.com_en_all_2023-11/questions/55574478/is-there-a-a-way-to-disable-swipe-back-animation-in-safari-on-ios)
- **Control over gesture navigation:** a WICG thread proposes an API for page control of user gesture navigation. No shipped API was found. **[S]** Source: [WICG discourse: API to control user gesture navigation](https://discourse.WICG.io/t/proposal-api-to-control-user-gesture-navigation/1536)
- **Android back closes the dialog:** the Android back gesture/button is a close request, which closes an open `<dialog>`/popover (Chrome 120+). **[S]** Source: [Chrome 120 blog](https://developer.chrome.com/blog/new-in-chrome-120)

### Inferences
- **Strip CSS:** `overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; touch-action: pan-x pan-y;` (allow vertical page scroll through the strip). Add scroll-padding or inline padding of at least 16–24px so swipes start away from the system edge-gesture zones on Android gesture navigation and iOS.
- **Swipe on the scroller, not the thread:** don't make the whole conversation a horizontal swipe target for switching agents. That collides with the system back gesture and with text selection. Limit the swipe to the icon strip, which is a native scroller, so the browser resolves the conflicts.
- **Handle-only `touch-action: none`:** on the bottom sheet, use `touch-action: none` only on the drag handle. The sheet body stays scrollable (`overscroll-behavior: contain`, so pull-to-refresh doesn't trigger behind the sheet).

### Gaps
- No authoritative 2026 source on whether Chrome Android's system back-gesture zone width or behaviour interacts with in-page horizontal scrollers (for example, the Android 14+ predictive back animation in Chrome).
- Current iOS 26 behaviour of `overscroll-behavior-x` against the edge swipe is unconfirmed.

## 5. Vibration API and haptics

### Takeaway
`navigator.vibrate()` works on Chrome Android, the main audience. It doesn't work on iOS Safari (WebKit hasn't implemented it and Apple has signalled no plans) or on Firefox since version 129. Use it only as an optional, feature-detected tick on agent commit, and respect user preference. No standard haptics API has shipped.

### Cited Findings
- **W3C implementation report** (verified 2026-04-09): WebKit (Safari macOS, iOS, iPadOS) has not implemented the Vibration API. **[S]** Source: [W3C Vibration implementation report](https://w3c.github.io/vibration/reports/implementation.html)
- **Apple's position:** a March 2026 W3C device-APIs post says Apple has not indicated plans to support it. **[S]** Source: [public-device-apis-log 2026-03](https://lists.w3.org/Archives/Public/public-device-apis-log/2026Mar/0000.html)
- **Firefox:** no longer exposes the API on any platform since version 129. **[S]** Source: [web-haptics browser support (Mintlify docs)](https://www.mintlify.com/lochie/web-haptics/advanced/browser-support)
- **iOS workaround:** libraries such as WebHaptics toggle a hidden `<input type="checkbox" switch>` (Safari 17.4+) to trigger system haptics. This undocumented side effect could break. **[S]** Sources: [azukiazusa: iOS Safari web haptics](https://azukiazusa.dev/en/blog/ios-safari-web-haptics); [web-haptic-engine platform support](https://sumitsahoo.github.io/web-haptic-engine/docs/guide/platform-support.html)

### Inferences
- Use `if ('vibrate' in navigator) navigator.vibrate(10)` once on commit, never per intermediate snap. Low-end Android devices vary in vibration-motor quality.
- Don't adopt the iOS switch hack. It's fragile, it puts a fake control into the accessibility tree, and the audience is mostly Android.
- Haptics must never be the only feedback. The visual selected state and the status message carry the change.

### Gaps
- No newer standards-track haptics proposal (beyond the Vibration API and the WebHID/gamepad haptics routes) was found in this session.
- Chrome Android may need user activation for vibrate (sticky activation). This wasn't re-verified.

## 6. Web App Manifest shortcuts; theme-color (media, dynamic updates)

### Takeaway
Manifest `shortcuts` work on installed PWAs on Android Chrome (long-press the icon) and most desktop systems. I found no confirmed iOS support. `theme-color` with `media="(prefers-color-scheme: dark)"` works on Chrome Android. Caniuse now marks iOS Safari 26+ as **not supported** for `theme-color` (supported 15–18.7). Sources conflict on whether Safari 26 still honours it for installed web apps.

### Cited Findings
- **Manifest shortcuts:** web.dev describes them as available on "most desktop systems and Android". **[S]** Source: [web.dev Learn PWA: enhancements](https://web.dev/learn/pwa/enhancements)
- **iOS:** an old Apple developer-forum thread lists shortcuts among unimplemented manifest members. This is old and doesn't settle current state. **[S]** Sources: [Apple Developer Forums thread 649097](https://developer.apple.com/forums/thread/649097); [firt.dev iOS PWA compatibility notes](https://firt.dev/notes/pwa-ios/)
- **`theme-color` on caniuse:**
  - Chrome for Android: "partial" (version 157). **[V]**
  - iOS Safari: supported in 15–18.7, not supported in 26.0–26.6, 27.0 and 27.1–27.2. **[V]**
  - Desktop Safari 26.0–27.1: partial. **[V]**
  - Firefox: not supported. **[V]**
  - Samsung Internet: supported from 6.2. **[V]**
  - The meta tag overrides the manifest `theme_color`. **[V]**
  - Source: [caniuse: theme-color meta](https://caniuse.com/meta-theme-color)
- **Conflict over Safari 26 behaviour:** one guide says iOS 26 Safari ignores the tag and tints from the page background. An MDN browser-compat-data PR says Safari 26 uses it only for installed web apps. **[S]** Sources: [DEV: meta theme-color reference](https://dev.to/joseph_anady_214bacedf939/html-meta-theme-color-canonical-reference-kc2); [MDN BCD PR 28503 (mirror)](https://gh.r-mj.com/mdn/browser-compat-data/pull/28503)
- **`media` attribute:** Safari 15 introduced support for the `media` attribute and `prefers-color-scheme` on `theme-color`. **[S]** Source: [CSS-Tricks: Safari 15 theme-color](https://css-tricks.com/?p=343850)

### Inferences
- Add manifest `shortcuts` (one per agent, for example `/?agent=booking`) for Android installs. This is harmless elsewhere. The URLs double as the no-JS deep links to a preselected agent, which the server should honour.
- **Light and dark `theme-color`:** ship two `<meta name="theme-color" media="(prefers-color-scheme: ...)">` tags using token colours.
- **Per-agent tint:** if wanted, update the `content` attribute dynamically in JS (Chrome Android repaints the toolbar; that is prior knowledge, not re-verified). On iOS 26+, set the `html`/`body` background or a top bar colour instead, since Safari now tints from page colours.
- **Theme colour is decoration only.** It must not be the only signal of the active agent (WCAG 1.4.1, use of colour).

### Gaps
- I found no authoritative 2026 source (WebKit release notes) for iOS 26 manifest `shortcuts`, or for `theme-color` behaviour in installed iOS web apps.
- The reason caniuse marks Chrome Android as "partial" for theme-color wasn't shown. It may concern `media` or dark mode.
- I found no source confirming dynamic `theme-color` updates in Chrome Android in 2026.
