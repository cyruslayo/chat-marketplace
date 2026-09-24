# Shortlet Design System Direction

This specification translates the UI audit into implementable presentation rules for the Guest shell, Weaver Basic Catalog surfaces and compact Operator screens. It does not prescribe or change product commands, domain state, Weaver/A2UI architecture, route behavior, or payment capability. Read with [the audit](shortlet-ui-ux-audit.md) and [landing direction](shortlet-landing-page-direction.md).

## Design proposition

**Residential hospitality with editorial restraint:** real Abuja/Lagos accommodation photography is the emotional entry point; a quiet warm-paper background and deep green action color create a composed host-like welcome; ink-dark type, generous labels and clear amounts make consequential decisions feel precise. It should look like a considered Nigerian accommodation service, not a generic chatbot, SaaS dashboard, luxury hotel campaign, Airbnb imitation or AI gradient demo.

Density is low at first entry, medium for cards and detail, deliberately high only for a side-by-side comparison or full booking review. Use whitespace around the next action, not around every metadata item. Photography is large enough to show interior character, but never covers price, accessibility text or state. Use flat tonal surfaces and thin borders; reserve one restrained elevation for the active workspace and sticky action layer. Motion is brief and nonessential (surface crossfade/height changes only if reduced motion is respected); no ambient animations, glass, glow or auto-rotating carousel. Brand color is roughly a minority accent against paper, white and ink. Use warm neutral/canvas tones; don't encode Abuja/Lagos in unrelated bright city colors.

## Governing principles

1. **Conversation guides; workspace acts.** The transcript can explain and preserve continuity, while the single current workspace owns the actionable stage, authoritative facts and next command.
2. **A stay is pictured before it is sold.** Lead with honest, representative room photography when approved; don't substitute diagram-like illustrations or stock scenes for an actual Unit.
3. **One state, one dominant next action.** A stage shows a human-readable status and one primary action. Secondary choices are visually quieter and never compete with required consent.
4. **All-In Stay Total leads; a deposit never disappears into it.** Show the total for the selected dates/party, then separate deposit and Amount Due Now only from authoritative quote facts.
5. **Generated surfaces speak the same interface language.** Weaver composition may vary, but semantic roles, spacing, status labels, money hierarchy, image ratio, target sizes and command clarity remain consistent.
6. **Booking state stands without chat history.** A Guest reopening the app can tell whether a Draft exists, an Operator has responded, payment is pending or a Reservation is confirmed from the current surface alone.
7. **Mobile is the base layout, not a reduced desktop.** Design one content order that flows at 320px; widen that order at tablet/desktop without adding a permanent chat side canvas.
8. **Disclose what a claim means, then disclose more on demand.** Use precise inspection/payment/identity claims; summarize routine facts, group longer detail, but do not hide material quote/policy terms at decision time.

## Design tokens

Semantic roles define use; the palette is a starting application proposal. Contrast figures are calculated with WCAG relative luminance against white and the proposed canvas, not promises about gradients or opacity composites. Keep exact values solid for text and controls.

### Semantic colors

| Role | Proposed value | Usage/contrast |
| --- | --- | --- |
| Canvas/background | `#F6F5F0` | Main warm neutral; content doesn't sit on an image background. |
| Primary surface | `#FFFFFF` | Cards, input fill, readable text panels. |
| Secondary surface | `#EEECE5` | Grouped info, neutral subpanels and subtle control background. |
| Elevated/focused surface | `#FFFFFF` | Same white plus border and restrained shadow; only active workspace/sticky layer. |
| Primary text | `#1D2923` | About 15.1:1 against white, 13.8:1 against canvas. |
| Secondary text | `#49574E` | About 7.6:1 white, 7.0:1 canvas. |
| Muted text | `#5D6A62` | About 5.7:1 white, 5.2:1 canvas; not for disabled text if reduced further. |
| Border/strong divider | `#747C75` | About 4.3:1 white and 3.9:1 canvas. Use for boundaries required to identify controls; lighter lines can be decorative only. |
| Brand / primary action | `#0B5C46` | White text contrast about 8.0:1; primary action only. |
| Hover | `#084735` | White text contrast about 10.7:1. |
| Pressed | `#063A2C` | Deeper green; white label retained. |
| Focus | `#995300` | 5.85:1 white, 5.36:1 canvas; 3px outline plus 2px offset, not color-only. |
| Success | `#176B49` | 6.49:1 white; pair with pale `#EAF4EE`, check/icon and explicit status text. |
| Warning | `#7A4C00` | 7.34:1 white; pair with `#FFF2D6`, symbol and explicit deadline/state. |
| Danger | `#A12B2B` | 7.25:1 white; pair with `#FCECEC`, text/icon. Reserve for decline/failed/critical message, not routine expiry. |
| Information | `#185F83` | 6.99:1 white; pair with `#EAF3F8` and explicit label. |

For focus/status/border shapes, maintain at least 3:1 against adjacent colors per WCAG non-text contrast. Do not reduce these values with opacity; test rendered compositing. Never make semantic state color-only. Disabled controls use clear shape/label and an explanatory adjacent message; maintain readable disabled text rather than relying on washed-out opacity.

### Type system

Use local/system stack: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Avoid requiring a remote font or many weights on Nigerian networks. If brand later selects a webfont, subset WOFF2, use `font-display: swap`, retain the stack fallback, and prove its value through rendered comparison before adding it.

| Token | Size / line height | Weight and role |
| --- | --- | --- |
| Display | 40/46px desktop; clamp down to 32/38px on narrow screens | 650–700; landing hero only, max ~12 words per line. |
| H1 | 32/38px desktop; 28/34px mobile | 650–700; one page-level title. |
| H2 | 24/30px | 650; section or main workspace title. |
| H3 | 19/26px | 600–650; Unit/result title. |
| Body | 16/24px | 400; guest-readable descriptions and form copy. |
| Small | 14/20px | 400; supporting explanatory text. |
| Metadata | 12/16px minimum | 500; dates/secondary status only. Never use for required money, deadline, form error or trust fact. |
| Label/button | 15–16/20px | 600; persistent form labels, action labels. |
| Price emphasis | 24/30px for total; 16/24px supporting | 650–700; all totals share one visual scale. |

Use tabular numerals for aligned prices/deadlines where available. Keep prose left aligned, max reading line length approximately 70–80 characters. Don't uppercase entire labels for hierarchy. No scaling essential text below 14px; page zoom to 200% must reflow without loss.

### Spacing, radius, elevation

Spacing scale: `4, 8, 12, 16, 24, 32, 48, 64px` (4px base); standard body rhythm 16px, between card sections 24px, outer mobile gutter 16px, desktop section spacing 48–64px. Avoid inconsistent micro-spacing introduced by arbitrary component margins.

Radius: `4px` small field/subtle label detail; `8px` controls/small media; `12px` cards/photos; `16px` one top-level workspace/featured section. No 999px pills for cards or full-size controls. A small badge may be fully rounded only if that does not erase semantic distinction.

Elevation: default use tonal surfaces + 1px border, no shadow. Active workspace and sticky mobile action layer may use one broad, low-opacity shadow (`0 8px 24px rgba(29,41,35,.08)`) with a visible border. Hover doesn't depend on lift. No nested card-within-card treatment; group details by divider/heading.

### Layout widths and behavior

| Context | Width/gutters |
| --- | --- |
| 320px mobile | 16px page gutters (288px content); reduce to 12px only if a known browser safe-area inset consumes the edge. |
| 390px mobile | 18px gutters; single column; sticky composer respects `env(safe-area-inset-bottom)`. |
| Tablet, ~768px | 24px gutters; single-column reading order; list may become 2 columns only where each card retains title, total and 44px action clarity. |
| Desktop, 1024px+ | 32px gutters; centered max app width 1120px; guest conversational reading column 720px; workspace max 760px; landing body max 1200px. |
| Body copy | ~70ch; never stretch paragraphs across full desktop width. |

At 320px money labels and amount stack; don't force a horizontal price table. At desktop, conversation and workspace remain one center column in a single flow. No permanent desktop side canvas. Detail may use adjacent gallery and summary only if heading-to-price reading sequence remains coherent and responsive order remains accessible.

## Interaction states and controls

- **Default:** visible label, contrast-compliant boundary and explicit action verb.
- **Hover:** subtle fill/border shift; no hover-only content; preserve contrast.
- **Pressed:** visible change to deeper brand tone; no delayed feedback.
- **Focus-visible:** continuous 3px high contrast outline with 2px offset; never remove browser indication without replacement.
- **Disabled:** stay discoverable when state explanation matters; native `disabled` where activation is unsafe, with nearby reason. Do not rely on opacity alone.
- **Loading:** action label changes to current command, control blocks duplicate submission and current facts remain visible. Only show spinner alongside readable text; reduced motion removes animation.
- **Destructive:** decline is distinct, secondary visual weight until chosen; clear affected Booking Request and effect. Confirm is not a red action.
- **Stale:** remove action authority and show current state route/refresh; old surface is read-only, visually labeled and not merely gray-disabled.
- Practical target minimum 44×44 CSS px (ADR-0078); spacing between compact secondary targets prevents accidental adjacent activation. Text fields at least 48px tall and 16px font on mobile.
- Use native `<button>`, `<a>`, `<label>`, `<form>`; no fake interactive divs. Submit using form semantics, preserve IME composition for Enter-key submission, and keep error/hint association.

## Component inventory and ownership

Inventory is conceptual only. “Basic Catalog expressive” means the information may be composed from currently approved Basic Catalog primitives if their actual semantics and browser output pass review; it does not promise a particular component or create a new A2UI schema.

| Component | Responsibility | Presentation channel |
| --- | --- | --- |
| Button | Primary/secondary/destructive/quiet action states and sizing. | Shell/conventional + Weaver Basic Catalog expression where available. |
| IconButton | Icon action with visible/accessible text name and target. | Shell/conventional; use in Weaver only when output name is proven. |
| TextField | Native input with focus, invalid, disabled and autofill states. | Shell/conventional; Basic Catalog input only after AX-tree verification. |
| FormField | Persistent visible label, hint, input and associated error. | Shell/conventional; A2UI grouping semantic constraint. |
| Select | Native select only when bounded canonical options improve entry over prose; never for arbitrary free-form neighborhood. | Shell/conventional; avoid unless approved Basic Catalog control exists. |
| MoneyDisplay | Exact NGN amount with label, currency and optional secondary hierarchy. | Shared semantics; shell + Basic Catalog text groups. |
| StatusBadge | Compact state label + optional icon, never color alone. | Shell/conventional and Basic Catalog text/status expression. |
| Alert | Context-preserving info/warning/error, role/live priority matched to urgency. | Shell/conventional; safe text fallback where rich fails. |
| Photo | Responsive Unit image, stable aspect ratio, alt and placeholder/error fallback. | Shell/conventional and approved image catalog primitive. |
| PhotoGallery | Progressive accessible gallery; no auto-rotation. | Conventional detail shell; Basic Catalog image sequence only if accessible. |
| StayCard | One result summary with title/location/facts/all-in total/action. | Weaver Basic Catalog composition constraint; also conventional discovery. |
| StayFacts | Bedrooms, bathrooms, capacity and Entire Place. | Shared shell + Basic Catalog semantic group. |
| AmenityList | Human labels grouped by user relevance, not raw enum values. | Shared content projection requirement. |
| PriceBreakdown | All-In Stay Total first, mandatory itemization and separate deposit/Amount Due Now when present. | Shared semantics; Basic Catalog rows only if hierarchy kept. |
| ConversationTurn | Timeline with user/assistant attribution, sensible reading order and optional time. | Shell only. |
| Composer | Labeled message input/send, loading/disabled/error draft retention. | Shell only. |
| Workspace | Current/focused task container with state and return path. | Shell only; wraps generated surface. |
| SurfaceHeader | Human task title, current state, safe return/close affordance. | Shell wrapper above Weaver; never agent-defined heading semantics. |
| BookingProgress | Stage label/state sequence without invented stages or false completion. | Shared shell and Basic Catalog text expression. |
| RequestSummary | Unit/stay/party/status/price/deadline summary. | Shared semantics; usable by generated/current and conventional route. |
| OfferSummary | Issued Offer, final quote, deposit, Amount Due Now and deadline. | Basic Catalog expression + conventional fallback. |
| PaymentSummary | Exact amount, hosted boundary, deadline and verification/pending state. | Basic Catalog expression + conventional fallback. |
| BookingConfirmation | Confirmed Reservation facts distinct from access readiness. | Basic Catalog expression + conventional route. |
| EmptyState | Query/context retention, reason and useful refinements. | Shared semantics; rich or conventional. |
| ErrorState | Plain cause, retained data, recovery path, state certainty. | Shell/conventional; safe fallback should be fully available without Weaver. |
| Skeleton/loading pattern | Reserve geometry for known content; decorative skeleton hidden from AT; announce only meaningful wait. | Shell/conventional + catalog composition where justified. |
| OperatorRequestRow | Scan human Unit, Guest/date, amount, urgency/status; ID secondary. | Conventional Operator. |
| OperatorRequestDetail | Full decision facts and explicit separate confirm/decline. | Conventional Operator; no chat dashboard expansion. |

### Accessibility acceptance for design implementation

- Exactly one page-level H1 per route/screen, sequential heading structure; landmarks for header/nav/main/footer, skip to meaningful primary content, not just a chat input.
- Logical tab sequence follows displayed content; no positive tabindex. When active workspace is replaced, focus moves to its new heading or first primary control, then returns sensibly when closed.
- Explicit labels remain visually present; hints/errors use `aria-describedby`; native `required`/`type`/autocomplete where appropriate. Inline validation preserves values, identifies field and correction, and moves focus only when needed.
- Live updates: polite announcement for new result count/current state; assertive only for time-critical expiry/data-loss/security events. Do not announce streaming tokens, timestamps ticking each second, or repeated “ready” messages. Dynamic content remains available to AT after change.
- Weaver `accessibility.label` metadata cannot be assumed to map to `aria-label`. Inspect actual DOM and browser accessibility tree for every interactive Basic Catalog class used; use visible labels and standard routes when names/roles fail. No false pass based on A2UI schema.
- Photos: informative listing image alt describes relevant visible room feature and location context without “photo of”; decorative treatment alt empty. Broken image retains Unit title/location and an identified image-unavailable fallback.
- Payment status is textual (`Payment pending`, `Payment verified`, `Reconciliation in progress`) with semantics and exact amount; do not use green-only success or spinner-only pending.
- At 320px and 200% zoom, reflow without horizontal page scroll for ordinary text, price breakdown, Operator action labels and form errors. Respect `prefers-reduced-motion`; ensure status shapes and focus indicator meet 3:1 non-text contrast.

### Foundation implementation entry points

The shared semantic tokens and opt-in presentation primitives live in `apps/web/src/shortlet-foundations.css`. Conventional Guest and Operator pages consume it through `/shortlet-foundations.css`; use the semantic variables for approved roles and the `ui-*` classes for reusable controls, status, money and image treatments. Weaver Basic Catalog content inherits the document typography, text color and focus indication where browser semantics permit; keep its renderer and component tree untouched, and verify generated controls in the rendered accessibility tree before relying on generated labels or component-specific styling.

### Performance design acceptance

- First useful text (city entry, current stage, result title/total) precedes nonessential inventory imagery. Set image width/height or `aspect-ratio` and reserve placeholder size. `srcset`/`sizes` align to card/detail rendering width; lazy-load offscreen images, never lazy-load the above-fold lead image.
- No required remote font or unnecessary icon/image library; use CSS/native text icon fallback. Avoid heavy maps, video or decorative asset until value and network budget are validated.
- Loading language names operation class: concierge reasoning, server-side booking command, hosted provider redirect. Use different text and expected recovery, not a single generic spinner.
- If connectivity drops, retain current projection and unsent composer; show offline/retry affordance. On reconnection refresh state before resubmitting consequential action. An uncertain payment remains pending/reconciliation, not failed/confirmed guess.
- Use skeleton only where final layout geometry is known; prefer concise text for a short state and no movement/CLS. For long images, paint stable neutral ratio box while media fetches.
