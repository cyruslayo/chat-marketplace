# Motion and animation technology for a stateful agent mark and mode-switch transitions (as of 2026-11-08)

Context: mobile-first chat web app, vanilla TypeScript client, Nigeria audience (low-end Android, Chrome-dominant, constrained networks). Agent mark states: idle, listening, thinking, responding, suggesting, switching, resting, human takeover. Shell must transition between agent modes.

## View Transitions API: support, types, classes, nested groups, element-scoped, pitfalls

### Takeaway
Same-document view transitions (`document.startViewTransition`) have been Baseline Newly available since 14 Oct 2025 (Firefox 144 was the last engine), so they are safe as a progressive enhancement. Transition types arrived in Firefox 147. Nested groups (Chrome 140) and element-scoped transitions (`element.startViewTransition`, Chrome 147) are Chromium-only. That is acceptable for a Chrome-dominant audience only behind feature detection. Element-scoped transitions are the best fit for a chat shell: they block only the subtree and allow concurrent transitions.

### Cited Findings
- Same-document view transitions became Baseline Newly available on 14 Oct 2025, when Firefox 144 shipped them. Firefox 144 supports `document.startViewTransition()`, `view-transition-name`, `view-transition-class`, `view-transition-name: match-element` and `:active-view-transition`. — [web.dev: Same-document view transitions are Baseline](https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available)
- Firefox 144's initial implementation did **not** include view transition types. web.dev recommended a `transitionHelper` for progressive enhancement. — [web.dev](https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available)
- Firefox later implemented view-transition types (Bugzilla 2001878, RESOLVED FIXED, release-note tracking flag 147+). caniuse lists `:active-view-transition-type()` as unsupported in Firefox 2–146 and supported in 147+. One Spanish-language Chrome page says "Firefox 144", which looks outdated or wrong. — [Bugzilla 2001878](https://bugzilla.mozilla.org/show_bug.cgi?id=2001878); [caniuse :active-view-transition-type()](https://caniuse.com/mdn-css_selectors_active-view-transition-type)
- The Chrome 2025 update lists Safari 18 / 18.4 for basic same-document view transitions and `match-element`. `view-transition-name: match-element` shipped in Chrome/Edge 137 and Firefox 144. — [Chrome for Developers: What's new in view transitions (2025)](https://developer.chrome.com/blog/view-transitions-in-2025)
- Nested view transition groups (`view-transition-group` property, nested `::view-transition-group` pseudos; enables clipping and 3D transforms inside groups) shipped in Chrome/Edge 140. Firefox and Safari: not supported. — [Chrome 2025 update](https://developer.chrome.com/blog/view-transitions-in-2025); [Chrome docs: nested view transition groups](https://developer.chrome.com/docs/css-ui/view-transitions/nested-view-transition-groups?hl=en)
- WebKit's standards position on nested view transitions was "No signal" in Chrome's Intent to Ship (26 Feb 2025). — [blink-dev Intent to Ship: Nested view transitions](https://groups.google.com/a/chromium.org/g/blink-dev/c/gVF8wCsqzIw)
- Element-scoped view transitions (`element.startViewTransition()` on any HTMLElement) shipped in Chrome/Edge 147 and were testable from Chrome 140 behind "Experimental Web Platform features". Firefox and Safari: not supported. — [Chrome 2025 update](https://developer.chrome.com/blog/view-transitions-in-2025)
- caniuse (element-scoped): Chrome 147+, Edge 147+, Chrome for Android 157 supported. Safari (through 27.x / TP), iOS Safari, Firefox (through 162) and Firefox for Android: not supported. About 67.8% global usage. — [caniuse: element-scoped view transitions](https://caniuse.com/wf-view-transitions-element-scoped)
- How element-scoped transitions differ from document-scoped ones, per MDN:
  - **Concurrency:** several can run at once, including nested ones. Document-scoped allows only one at a time.
  - **Interaction:** only the scope is paused during snapshotting. A document transition makes the whole page non-interactive until it finishes.
  - **Rendering:** the `::view-transition` tree sits inside the scope element, matches its size, respects outside `z-index` layering and is clipped to the scope.
  - **Applied automatically to the scope root:** `view-transition-name: root`, `view-transition-group: contain` (gives `overflow: clip`) and `view-transition-scope: all` (subtree-scoped names).
  - **Pitfalls:** setting `view-transition-name: none` on the root opts it out and can let content spill; names set outside the scope won't match inside it; without feature detection, calling `el.startViewTransition` throws in unsupported browsers.
  - **API surface:** `ViewTransition.transitionRoot`, `Element.activeViewTransition`.
  — [MDN: Using element-scoped view transitions](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using_element-scoped)
- Other 2025 changes in Chrome:
  - `::view-transition` changed from `position: fixed` to `absolute` in Chrome 142.
  - `document.activeViewTransition` is in Chrome/Edge 142, Firefox 147 and Safari 26.2.
  - `ViewTransition.waitUntil()` was announced as "coming later this year" with no version given.
  - Chrome 140 changed `finished` timing so cleanup runs asynchronously, which avoids end-of-transition flicker.
  - Chrome 140 lets more `animation-*` properties inherit into the pseudo children.
  — [Chrome 2025 update](https://developer.chrome.com/blog/view-transitions-in-2025)
- Interop 2026 (announced 12 Feb 2026) includes View Transitions as a focus area. It covers improving same-document transitions, `:active-view-transition-type()`, `blocking="render"`, `<link rel="expect">` and cross-document view transitions. — [web.dev: Interop 2026](https://web.dev/blog/interop-2026?hl=en); [Microsoft Edge blog](https://blogs.windows.com/msedgedev/?p=26153)
- Performance on low-end devices:
  - A Core Web Vitals analysis found CPU speed correlates strongly with the LCP penalty from page transitions, which matters most on low-end mobile. Honouring reduced motion removes that penalty for those users. — [corewebvitals.io](https://www.corewebvitals.io/pagespeed/view-transition-web-performance)
  - A community tutorial reports frame drops at about 20 named element pairs on lower-end phones. This is anecdotal, not a controlled benchmark. — [pravinkumar.co](https://www.pravinkumar.co/blog/view-transitions-api-webflow-spa-navigation-tutorial-2026-fa861)
  - Shopify relays Chrome guidance to cancel/skip view transitions when the user interacts, to avoid input delay, and to skip `startViewTransition` when `prefers-reduced-motion: reduce` matches. — [Shopify: cancel view transitions on interaction](https://shopify.dev/docs/storefronts/themes/best-practices/performance/cancel-view-transitions-on-interaction)
- Reduced motion: sources disagree on whether browsers adapt view transitions automatically. Nuxt explicitly disables view transitions under `prefers-reduced-motion: reduce`, so handle it explicitly. — [Nuxt PR #22292](https://codspeed.io/nuxt/nuxt/branches/lukewarlow:view-transition-prm); [Shopify](https://shopify.dev/docs/storefronts/themes/best-practices/performance/cancel-view-transitions-on-interaction)

### Inferences
- For mode switches, use `document.startViewTransition({ update, types: ['mode-to-human'] })` with feature detection. Engines without types support (Firefox 144–146, older Safari) fall back to the callback form or no transition. Style by `:active-view-transition-type(...)`, with `view-transition-class` for shared group styling.
- Where available (Chromium 147+, which is most of the target audience), prefer `shellEl.startViewTransition(...)` so the composer stays interactive during a mode switch. Fall back to the document-scoped transition, or none, elsewhere.
- Keep named elements to a handful: the header mark, mode banner, composer and active workspace. Use `match-element` or `view-transition-class` instead of per-message unique names to avoid duplicate-name failures.
- Never put the mark's continuous state loop inside a view transition. View transitions are for discrete shell changes; the mark's idle/thinking loop belongs in CSS/WAAPI.

### Gaps
- No authoritative per-version Safari data for `view-transition-types` / `:active-view-transition-type()` was retrieved. The Chrome 2025 post's Safari 18.x figures cover the base API and match-element.
- No quantified memory or frame-time benchmarks for view-transition snapshots on low-end Android were found.
- `ViewTransition.waitUntil()` ship version not confirmed.
- No WebKit release note confirmed nested groups or element-scoped transitions in Safari 26.x. caniuse says unsupported through 27.x.

## CSS @property, linear() springs, individual transforms, SVG animation approaches, compositor-only properties

### Takeaway
`@property` (Baseline July 2024) makes typed custom properties such as `<angle>`, `<number>` and `<color>` interpolable. That is ideal for hue/angle/glow effects on the mark, but those properties drive paint, not compositing. Chrome has hardware-accelerated SVG animations of `transform`/`opacity`/`filter` since Chromium 89. Animating SVG with CSS or the Web Animations API on composited properties is the cheapest path; SMIL adds nothing for this use case.

### Cited Findings
- `@property` / registered custom properties became Baseline (Newly available) on 2024-07-09 with Firefox 128, the last engine to ship. — [web-features explorer](https://web-platform-dx.github.io/web-features-explorer/features/registered-custom-properties); [MDN @property](https://developer.mozilla.org/docs/Web/CSS/Reference/At-rules/@property)
- Registration is what enables interpolation. An unregistered custom property flips discretely halfway through the animation. — [matuzo.at, Day 104](https://matuzo.at/blog/2023/100daysof-day104)
- Known Firefox bug: a `var()` value used as a keyframe step for a registered property does not animate properly (Bugzilla 1899531, open). A separate bug reports registered properties rarely firing `transitionstart` (1916203). — [Bugzilla 1899531](https://bugzilla.mozilla.org/show_bug.cgi?id=1899531); [Bugzilla 1916203](https://bugzilla.mozilla.org/show_bug.cgi?id=1916203)
- Sources conflict on Safari's version for `@property`: most say 16.4, one says 15.4. — [zudo-css](https://zudo-css.pages.dev/pj/zcss/docs/styling/effects/at-property); [MDN](https://developer.mozilla.org/docs/Web/CSS/Reference/At-rules/@property)
- `linear()` easing is supported in Chrome/Edge 113 and Firefox 112. Safari 17.2 appears only on a translated copy of the same Chrome article; one stale README contradicts it, but Safari 17.2 matches widely reported Baseline Dec 2023 status. Spring curves are built from a long `linear()` stop list, with `CSS.supports()` detection and a fallback. — [Chrome: linear() easing](https://developer.chrome.com/docs/css-ui/css-linear-easing-function); [Chrome modern-web-guidance: physics-based easing](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/physics-based-easing)
- Chromium 89 enabled hardware acceleration for SVG animations by default, joining Firefox. Composited properties then were `opacity`, `filter` and `transform`, with `background-color` and `clip-path` "soon". A spinner demo stopped repainting continuously in Chromium 89 compared with 88. — [Chrome: Updates in hardware-accelerated animation capabilities](https://developer.chrome.com/blog/hardware-accelerated-animations?hl=en)
- Before that change, SVG repainted every frame; the workaround was wrapping it in a composited div. That advice is now outdated. — [chromium-discuss thread](https://groups.google.com/a/chromium.org/g/chromium-discuss/c/cfpzb79vCMc)

### Inferences
- **Mark design:** a single inline SVG (no network request; themable with `currentColor` and CSS tokens). Drive state with a `data-state` attribute on the root:
  - Thinking/listening loops animate `transform` (individual `rotate`/`scale`/`translate` properties) and `opacity` on SVG groups, so they stay on the compositor.
  - Use `@property --hue/--angle` for colour sweeps (conic gradients, `hsl(var(--hue))`). These repaint each frame, so keep them on a small (~24–40px) element and pause them when idle or resting.
- **State changes:** use WAAPI (`el.animate()`, `getAnimations()`, `animation.finished`). It lets vanilla TS cancel or retarget a loop when state flips mid-animation (thinking to responding), commit end styles, and respect reduced motion in one place. CSS keyframes keyed on `[data-state]` are fine for steady loops.
- Avoid animating `filter: blur()` glows on low-end devices even though `filter` is accelerated. Large blur radii are expensive to rasterize. Prefer a pre-blurred static layer whose opacity/scale is animated. (This is inference, not measured.)
- Use `linear()` springs for the "switching" and "suggesting" pops, with a `cubic-bezier` fallback.

### Gaps
- No current (2025–2026) Chromium documentation listing exactly which SVG properties or sub-element transforms are composited; verify with DevTools paint flashing / Rendering > Frame rendering stats on a low-end device.
- No primary source retrieved for individual transform properties (`translate`/`rotate`/`scale`) support. Widely reported Baseline since 2022, but not verified in this session.
- No benchmarks found comparing SMIL with CSS with WAAPI on Android Chrome.

## Lottie (lottie-web), dotLottie (dotlottie-web, WASM), Rive vs inline SVG + CSS

### Takeaway
Inline SVG + CSS/WAAPI costs 0 KB of runtime and themes natively with CSS tokens, so it is the clear default for a small multi-state icon on constrained networks.
- **lottie-web:** about 46 KB gzipped (light build) plus JSON assets.
- **dotlottie-web:** about 33–35 KB JS, but its ThorVG WASM engine is fetched on first use, quoted from roughly 150 KB up to roughly 500 KB compressed.
- **Rive:** a WASM runtime of 222 KB brotli (canvas-lite) to 567 KB (canvas).

No independent benchmarks on low-end Android were found; all performance claims are vendor-authored.

### Cited Findings
- Rive's official runtime-sizes table (brotli -9): `@rive-app/canvas-lite` 707 KB uncompressed / 222 KB compressed; `@rive-app/canvas` 1728 KB / 567 KB. The WASM is most of the size. canvas-lite drops the text, layout, audio and scripting engines. — [Rive docs: runtime sizes](https://rive.app/docs/runtimes/runtime-sizes.md); [canvas-lite README](https://cdn.jsdelivr.net/npm/@rive-app/canvas-lite@2.37.8/README.md)
- Rive v2 migration notes cite about 261 KB brotli for the WASM at v2.0.0. — [Rive migration guide](https://rive.app/community/doc/migrating-from-v1-to-v2/doc9zpmqx6dg)
- Rive supports preloading or self-hosting the WASM via RuntimeLoader. — [Rive docs: preloading WASM](https://rive.app/docs/runtimes/web/preloading-wasm)
- A Japanese comparison measured lottie-web's light build at about 46 KB gzip and @rive-app/canvas at about 0.98 MB gzipped. It reports that the Rive web runtime is heavy even when the .riv file is small, and that the dotLottie web state-machine API is still marked experimental. — [issoh.co.jp](https://www.issoh.co.jp/md/tech/4461)
- dotlottie-web size figures:
  - JS player: about 33.4 KB gzipped (package listing) and 35–45 KB min+gzip (LottieFiles runtimes table). — [JSR @lottiefiles/dotlottie-web](https://jsr.io/@lottiefiles/dotlottie-web); [LottieFiles runtimes](https://docs.lottiefiles.com/en/runtimes)
  - WASM engine: LottieFiles' v0.x docs say it is fetched from a CDN the first time a player is constructed, at roughly 500 KB compressed. The marketing page cites about 150 KB for ThorVG. These figures conflict. — [LottieFiles: How the web player works](https://docs.lottiefiles.com/en/runtimes/distributions/js/v0.x/core-concepts.md); [lottiefiles.com/dotlottie](https://lottiefiles.com/dotlottie)
- dotlottie-web renders with ThorVG and ships Software, WebGL2 and WebGPU backends. It supports runtime themes and slots (colour, scalar, text and vector overrides). — [GitHub dotlottie-web](https://github.com/LottieFiles/dotlottie-web); [dotlottie-rs](https://gh.r-mj.com/LottieFiles/dotlottie-rs); [LottieFiles blog: WebGL & WebGPU](https://lottiefiles.com/blog/working-with-lottie-animations/hardware-accelerated-lottie-on-the-web-dotlottie-web-now-ships-webgl-webgpu)
- LottieFiles claims dotLottie performance is "on par with Rive" and that its runtimes beat the old web player. This is a vendor claim with no reproducible benchmark. — [LottieFiles runtimes](https://lottiefiles.com/runtimes)
- A March 2026 comparison gives these figures without describing any benchmark method:
  - Bundle size: dotLottie about 50 KB, Rive about 200 KB, CSS 0 KB.
  - Complex Lottie JSON with embedded rasters: 500 KB–2 MB. `.lottie` (ZIP) is 70–80% smaller than the equivalent JSON.
  - Lottie and Rive must check `matchMedia('(prefers-reduced-motion: reduce)')` themselves and skip autoplay. CSS can use the media query directly.
  — [PkgPulse guide](https://www.pkgpulse.com/guides/lottie-vs-rive-vs-css-animations-web-animation-formats-2026)
- Callstack compares Lottie and Rive for mobile apps (native, not web). — [Callstack: Lottie vs Rive](https://callstack.com/blog/lottie-vs-rive-optimizing-mobile-app-animation)

### Inferences
- Canvas/WASM runtimes (dotLottie, Rive) render into a `<canvas>`. Every frame is drawn on the main thread (or a worker) and rasterized, not composited from cached layers. A continuously looping 32px icon would keep the CPU awake for the whole session, a battery cost on low-end Android. CSS transform/opacity loops on inline SVG are composited after the first raster.
- Theming: inline SVG inherits CSS tokens and dark mode (`currentColor`, `var(--token)`) for free. Lottie/dotLottie need slot/theme APIs, and Rive needs data binding or state-machine inputs. Every theme change becomes a JS call, which is not suitable for a token-only design system.
- Accessibility: a canvas has no semantic content. Inline SVG can carry `role="img"` with a state label, or be `aria-hidden` while a separate live region announces state.
- Network: Rive or dotLottie WASM (≥150–567 KB) is a large first-load cost on Nigerian mobile data compared with a ~2–4 KB inline SVG. Only an illustrative onboarding animation would justify lazily loading such a runtime.

### Gaps
- No independent CPU, battery or FPS benchmark of lottie-web, dotlottie-web, Rive or CSS on low-end Android was found.
- The exact current dotlottie-web WASM size is unresolved (the sources give conflicting figures).
- lottie-web full vs light build sizes and SVG vs canvas renderer costs were not verified from a primary source.

## Accessibility: reduced motion, WCAG 2.2 SC 2.2.2, 2.3.1, 2.3.3, pausing when hidden

### Takeaway
A looping "thinking" mark shown beside usable content counts as moving content that starts automatically, so if it can loop for more than 5 seconds it needs a pause, stop or hide mechanism, or it must stop on its own within 5 seconds. Design every looping state to settle into a static pose (or very low motion) after ≤5 s, honour `prefers-reduced-motion` with a non-motion state signal (colour, shape or label), and pause all loops when the page is hidden.

### Cited Findings
- SC 2.2.2 normative text: moving, blinking or scrolling information that (1) starts automatically, (2) lasts more than five seconds and (3) is presented in parallel with other content needs a mechanism to pause, stop or hide it, unless it is essential. Auto-updating content has no 5-second exception. — [W3C Understanding SC 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- "Five seconds was chosen because it is long enough to get a user's attention." — [W3C Understanding SC 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- What the 2.2.2 Understanding document says about loaders and automatic starts:
  - A preload animation "can be considered essential" when interaction can't occur during that phase and showing no progress would make users think content was frozen.
  - A loader that is the only content on the page is not "in parallel", so it needs no pause control.
  - Spinners are not named explicitly; a spinner beside usable content that runs more than 5 s likely needs a pause or stop mechanism (inference from the doc's logic).
  - "Starts automatically" includes animation triggered by indirect interaction such as focus, hover or scroll-into-view. Such content should also be checked against SC 2.3.3 (Animation from Interactions).
  — [W3C Understanding SC 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- Reduced motion with view transitions: skip `startViewTransition` when `prefers-reduced-motion: reduce` matches (Shopify, Nuxt), or zero the durations of the `::view-transition-*` animations. Explicit handling is recommended because sources conflict on default browser behaviour. — [Shopify](https://shopify.dev/docs/storefronts/themes/best-practices/performance/cancel-view-transitions-on-interaction); [Nuxt PR](https://codspeed.io/nuxt/nuxt/branches/lukewarlow:view-transition-prm)

### Inferences
- SC 2.3.3 (AAA) covers motion animation triggered by interaction, such as the mode-switch shell transition. It must be disableable unless essential; `prefers-reduced-motion` handling satisfies this in practice. SC 2.3.1 (A) bans more than three flashes in any one-second period. Avoid fast brightness or red pulses in the "listening" and "human takeover" states; keep pulses at 1 Hz or slower with soft opacity ranges.
- Pause when hidden:
  - On `document.visibilitychange` (`document.hidden`), call `getAnimations()` then `pause()`/`play()`, or set `animation-play-state: paused` via a root attribute.
  - Browsers already throttle rAF in background tabs, but CSS and WAAPI loops on a visible yet offscreen element still run. Use IntersectionObserver or `content-visibility: auto` on offscreen chat sections.
- Treat state as an accessibility signal separate from motion: the mark gets `role="img"` with `aria-label`, plus a polite live region for changes such as "Agent is thinking" and "A person has taken over". Under reduced motion, show the state through a static glyph change.

### Gaps
- The W3C Understanding pages for 2.3.1 and 2.3.3 were not fetched in this session; the notes on them come from general knowledge of WCAG 2.2.
- No primary source (MDN or web.dev) was fetched for `animation-play-state`, the `visibilitychange` pattern or `content-visibility` behaviour with running animations. Verify that `content-visibility: auto` skips work for running CSS animations in offscreen subtrees.

## How AI agent avatars and thinking indicators are commonly animated

### Takeaway
The commercial implementations (ChatGPT voice orb, Gemini spark, Siri glow, Claude's indicator) are not publicly documented. Open-source recreations use two tiers: WebGL/Skia shaders driven by audio amplitude for "voice orbs", and CSS conic gradients, blur, scale and rotate for lightweight orbs. Both tiers are typically keyed to explicit idle, listening, thinking, speaking and error states.

### Cited Findings
- Commercial orb internals are not public. Community components use WebGL shader-driven liquid spheres that "breathe and ripple" with voice activity, driven by Web Audio `AnalyserNode` amplitude. — [21st.dev: React voice orb components](https://21st.dev/blog/react-voice-orb-components)
- A ChatGPT voice-profile recreation uses a `@shopify/react-native-skia` RuntimeEffect shader, with Reanimated shared values feeding time and boost uniforms (React Native, not web). — [awesome-mobile-app-animations: ChatGPT voice profiles](https://adithyavis.github.io/awesome-mobile-app-animations/docs/animations/chatgpt-voice-profiles)
- A Siri-style CSS orb uses conic gradients and smooth rotation with customizable colours, and respects `prefers-reduced-motion`. — [21st.dev Siri Orb](https://21st.dev/@educalvolpz/components/siri-orb.md)
- An open-source orb defines idle, listening, thinking, speaking and error states, each with its own colours and keyframes (rays for speaking, slow breathing for thinking). — [Hugging Face Orbit.css](https://huggingface.co/spaces/Princeaka/multimodal_module/blob/main/frontend/src/components/Orbit.css)
- Pipecat's voice UI kit ships audio visualizer components (wave) for voice agents. — [Pipecat UI: Audio Visualizer Wave](https://ui.pipecat.ai/docs/visualizers/audio-visualizer-wave)

### Inferences
- For this app (text chat, no voice), the shader tier is unnecessary. Suggested mapping using a composited, CSS-token-driven inline SVG:

  | State | Motion | Compositing | Limit |
  |---|---|---|---|
  | idle | static | none | none |
  | listening (guest typing) | gentle 1 Hz scale/opacity pulse | composited | settles after 5 s |
  | thinking | slow rotation of an arc, or a `@property --angle` conic sweep (paint) | composited rotation; sweep repaints | static after 5 s, shown with a label |
  | responding | short one-shot streaming tick per token batch, not a loop | composited | one-shot |
  | suggesting | one `linear()` spring pop | composited | one-shot |
  | switching | the view-transition morph of the mark between headers | view transition | one-shot |
  | resting | desaturated, static | none | none |
  | human takeover | distinct static glyph or colour, plus a live-region announcement | none | none |

- The classic "typing dots" pattern (three dots with staggered `opacity`/`translateY` keyframes) stays composited and is cheap. Still cap it under SC 2.2.2, or treat it as a status that is replaced by content.

### Gaps
- No primary or engineering-blog source describes how Claude, ChatGPT (web), Gemini (spark) or Siri implement their indicators. Any claim about their internals would be speculation.
- No published measurements of battery or CPU cost for these indicator styles on low-end Android.
