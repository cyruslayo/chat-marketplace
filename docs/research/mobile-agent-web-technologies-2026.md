# Mobile agent web technologies

Research date: 2026-09-05. Advisory findings; no architecture decisions or implementation changes. Recommendations below are design judgments, not claims that a standard mandates a particular UX.

## Recommended direction

Use a conventional responsive web application containing conversation and a persistent task workspace. On mobile, open one focused task as a full-screen DOM view with a clear return to conversation; on desktop, conversation and workspace can sit alongside each other. Preserve ordinary Trips/booking routes so users can retrieve a booking, payment status, or support case without searching a transcript. Small agent results belong inline; complex comparisons, booking review, and recovery tasks deserve focused space. This extends the existing text/inline/focused presentation model.

“Canvas” should mean that task workspace, not a bitmap `<canvas>` or infinite spatial board. HTML canvas represents a bitmap and needs separately maintained focusable fallback content for interactive accessibility. Semantic DOM controls are a better foundation for booking forms and contracts; graphics can still use canvas locally. [WHATWG canvas specification](https://html.spec.whatwg.org/multipage/canvas.html).

## Protocol and repository fit

The official A2UI site currently labels v0.9.1 the production release and v1.0 a candidate; v0.8 is legacy. It describes declarative component descriptions rendered through client-owned components rather than arbitrary generated executable code. Stay pinned to the repository's v0.9.1 contract and tested Weaver package. Evaluate a candidate version separately rather than assuming wire compatibility. [A2UI versions and architecture](https://a2ui.org/).

AG-UI handles events between agent backends and frontends; A2UI describes generated UI. They are complementary layers, not substitutes. AG-UI is an available integration choice, not a prerequisite for using A2UI. [AG-UI overview](https://docs.ag-ui.com/).

Local [ADR-0081](../adr/0081-use-weaver-as-the-web-a2ui-runtime.md) explicitly removes mandatory AG-UI/CopilotKit, approves Weaver Basic Catalog first, and defers custom catalogues until insufficiency is demonstrated. It preserves authoritative backend commands, conventional route parity, WCAG 2.2 AA, current-state checks, and host-owned replay. The repository pins Weaver packages to the published 0.2.1 release from npm. Recommendation: polish host layout, Basic Catalog composition, and recovery before adding protocols or bespoke components. Agent flexibility should concern what useful view to present, while prices, deadlines, rights, and consequential action authority continue to come from domain services.

## Useful browser capabilities

| Capability | Supported fact | Recommendation for this application |
| --- | --- | --- |
| CSS Grid/Flexbox plus container size queries | Container queries make components respond to their available container space rather than only the viewport. [Browser-vendor guide](https://web.dev/articles/baseline-in-action-container-queries) | Let the same result adapt between inline chat, full-screen mobile, and desktop side pane. |
| HTML `dialog` and `popover` | Modal dialogs make underlying content inert; popovers do not provide modal behavior or inherent semantics. [Browser-vendor guide](https://web.dev/articles/baseline-in-action-dialog-popover) | Use a dialog for bounded confirmations and a popover for brief context. Use ordinary routes for long booking tasks rather than stacking modals. |
| Same-document View Transitions | Same-document transitions are included in the 2025 interoperability work; View Transitions appear in Baseline 2025. [Interop 2025](https://web.dev/blog/interop-2025), [Baseline 2025](https://web.dev/baseline/2025) | Enhance result-to-detail continuity after feature detection; keep ordinary navigation working and honor reduced motion. Baseline does not imply all older phones support a feature. |
| Safe-area CSS and viewport handling | WebKit exposes safe-area insets; keyboard resize behavior distinguishes layout and visual viewports. [WebKit safe areas](https://webkit.org/blog/7929/designing-websites-for-iphone-x/), [Chrome viewport behavior](https://developer.chrome.com/blog/viewport-resize-behavior/) | Keep composer and primary CTA clear of home indicators and keyboards. Test keyboard opening, rotation, browser chrome, and installed mode on devices; viewport units alone are not a keyboard strategy. |

## PWA, notifications, and recovery

iOS/iPadOS web push is available to Home Screen web apps from 16.4; permission must follow direct user interaction. A regular open browser tab is not equivalent to an installed push-capable app. [WebKit push documentation](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). Recommendation: make installation optional, invite notification subscription after a meaningful booking request, and retain a durable in-app activity/status view. Do not make receiving push the only way to discover an important deadline.

Browsers can freeze or discard pages, and mobile termination may occur without reliable unload events. [Chrome Page Lifecycle guidance](https://developer.chrome.com/docs/web-platform/page-lifecycle-api). Recommendation: agent jobs run server-side, persist their progress, and reconnect to a fresh authoritative snapshot after foregrounding. Offline UI may retain explicitly stale summaries and drafts, but must not claim to have booked or paid while disconnected.

Native EventSource supports reconnection and a `Last-Event-ID` header; this transports a cursor rather than providing a durable application event store. [WHATWG Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html). Recommendation: keep Weaver transport unless a demonstrated problem warrants changing it. Host-owned event ordering, durable cursors, replay/deduplication, idempotent commands, cancellation status, and snapshot recovery remain necessary whichever transport is chosen. Reconnect is not proof that an action failed or should be submitted again.

Voice can be an optional input experiment after the text/touch flow is strong. Preserve a visible interpreted request and typed correction; require explicit touch review for consequential actions. This is a product recommendation, not a claim of universal speech API support. No specific voice provider or browser speech API was validated in this research.
