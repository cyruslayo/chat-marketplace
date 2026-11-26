# Class Map: Round 12 (`bundle.css`) → Codebase

> **Note:** Standalone `project/components/*/README.md` files from `XH7yVkfLzKG357Gxqc1F3d` were not included in the exported HTML board bundles; this table is derived directly from the pinned [bundle.css](bundle.css) (215 `.ui-*` classes, including its inline comments), [xenia-kit.css](xenia-kit.css) (36 `xk-*` / `bd-*` board-only classes), [apps/web/src/shortlet-foundations.css](../../../../apps/web/src/shortlet-foundations.css), [apps/local-guest/src/guest-kit.ts](../../../../apps/local-guest/src/guest-kit.ts), [apps/local-owner/src/back-office-view.ts](../../../../apps/local-owner/src/back-office-view.ts), [apps/local-owner/src/local-owner-server.ts](../../../../apps/local-owner/src/local-owner-server.ts), and [test/guest-retired-classes.test.ts](../../../../test/guest-retired-classes.test.ts). Cross-check against README `"Maps to"` lines if `XH7yVkfLzKG357Gxqc1F3d` READMEs are exported later.

## Summary counts

- **`bundle.css` `.ui-*` classes:** 215 total
  - `exists`: 86 (already in `apps/web/src/shortlet-foundations.css`)
  - `renamed`: 26 (present in `apps/` under an earlier `.ui-*`, `.bo-*`, or bare class name)
  - `new`: 103 (new in round 12)
- **Board-only classes (`xk-*`, `bd-*`) in `xenia-kit.css`:** 36 — **must never enter `apps/`**.
- **Retired classes/identifiers (must remain absent, `test/guest-retired-classes.test.ts`):** `.waiting-panel`, `.stay-result`, `GUEST_STAY_PAYMENT_STYLE`.

---

## 1. `.ui-*` classes in `bundle.css`

### Foundations, utilities & layout

| `ui-*` class | Current code class | Status | Notes |
| --- | --- | --- | --- |
| `ui-page` | `ui-page` | exists | Container-query root (`container-type: inline-size`) |
| `ui-page--short` | – | new | Fixed-frame equivalent of `@media (max-height:37.49rem)` |
| `ui-icon` | `ui-icon` | exists | SVG icon primitive |
| `ui-visually-hidden` | `ui-sr-only` | renamed | Keep or alias `.ui-sr-only` (`shortlet-foundations.css`) |

### Buttons & links (`2b-01`)

| `ui-*` class | Current code class | Status | Notes |
| --- | --- | --- | --- |
| `ui-button` | `ui-button` | exists | Base button (`min-height: 48px` in `bundle.css`) |
| `ui-button--primary` | `ui-button--primary` | exists | Primary action (`--color-action`) |
| `ui-button--secondary` | `ui-button--secondary` | exists | Secondary action (`--color-action-subtle`) |
| `ui-button--quiet` | `ui-button--quiet` | exists | Quiet outlined action |
| `ui-button--pill` | – | new | Landing/pill CTA (`min-height: 52px`, `radius-pill`) |
| `ui-button--small` | `ui-button--small` | exists | Compact button (`min-height: 44px`) |
| `ui-button--block` | `ui-button--block` | exists | Full-width button |
| `ui-link` | `ui-link` | exists | Inline/standalone 44px text link |

### Fields, choices, banners, status, tags, deadline & facts (`2b-01`)

| `ui-*` class | Current code class | Status | Notes |
| --- | --- | --- | --- |
| `ui-field` | `ui-field` | exists | Field wrapper |
| `ui-field__label` | `ui-field__label` | exists | Field label |
| `ui-field__optional` | – | new | "(optional)" inline suffix |
| `ui-field__hint` | `ui-field__hint` | exists | Hint line |
| `ui-field__input` | `input` / `textarea` inside `.ui-field` | new | Explicit input class (`shortlet-foundations.css` styles bare controls) |
| `ui-field__error` | `ui-field__error` | exists | Inline validation message |
| `ui-choice` | `.payment-choice-methods label` | renamed | Radio/checkbox 44px row (`PaymentChoice`, `Report`) |
| `ui-legend` | `legend` | new | Fieldset legend styling |
| `ui-banner` | `ui-banner` | exists | Notice banner |
| `ui-banner__title` | – | new | Bold banner heading |
| `ui-banner__body` | – | new | Grid-column-2 body slot |
| `ui-banner__actions` | – | new | Action row inside banner |
| `ui-banner--neutral` | `ui-banner--neutral` | exists | Neutral surface banner |
| `ui-banner--info` | – | new | Info tone banner |
| `ui-banner--success` | `ui-banner--success` | exists | Success tone banner |
| `ui-banner--warning` | `ui-banner--warning` | exists | Warning tone banner |
| `ui-banner--danger` | `ui-banner--danger` | exists | Danger tone banner |
| `ui-status` | `ui-status` | exists | Status word (`14/20 700`) |
| `ui-status--success` | `ui-status--success` | exists | Success status tone |
| `ui-status--warning` | `ui-status--warning` | exists | Warning status tone |
| `ui-status--info` | `ui-status--info` | exists | Info status tone |
| `ui-status--danger` | `ui-status--danger` | exists | Danger status tone |
| `ui-status--muted` | `ui-status--neutral` / `ui-status--stale` | renamed | Muted status tone |
| `ui-tag` | – | new | Compact metadata tag (`radius-sm`) |
| `ui-tag--overdue` | `.badge-warning` (Operator) | renamed | Overdue tag on `warning-surface` |
| `ui-deadline` | `request-deadline` / `payment-deadline` | renamed | Deadline + remaining time block |
| `ui-deadline__at` | `waiting-deadline-time` | renamed | Absolute WAT deadline line |
| `ui-deadline__left` | `waiting-countdown` | renamed | Remaining minutes line |
| `ui-deadline--info` | – | new | Non-urgent deadline variant |
| `ui-deadline--overdue` | – | new | Underlined overdue deadline variant |
| `ui-facts` | `ui-facts` | exists | Key-value `<dl>` grid |
| `ui-facts--stacked` | `ui-facts--stacked` | exists | Stacked `<dl>` variant |
| `ui-money-total` | `ui-money-total` | exists | Display money total (`Newsreader 500`) |
| `ui-empty` | `ui-empty` | exists | Empty state card |
| `ui-empty__title` | – | new | Empty state heading |
| `ui-empty__body` | – | new | Empty state paragraph |
| `ui-skeleton` | `ui-skeleton` | exists | Static loading placeholder |
| `ui-skeleton--title` | – | new | Title skeleton |
| `ui-skeleton--card` | – | new | Card skeleton |
| `ui-skeleton--receipt` | – | new | Receipt skeleton |

### App shell, App bar, Tab bar, Ask bar, Task bar, Side nav & Journey rail (`2b-02`)

| `ui-*` class | Current code class | Status | Notes |
| --- | --- | --- | --- |
| `ui-app` | `app` | renamed | Full-height guest app flex shell |
| `ui-app__col` | – | new | Main column inside `.ui-app` |
| `ui-app__main` | – | new | Scrollable page content area |
| `ui-app__main--task` | `ui-page--narrow` | renamed | Centered 640px task column |
| `ui-app__foot` | – | new | Sticky footer holding Ask bar + Tab bar |
| `ui-appbar` | `ui-appbar` | exists | Top bar |
| `ui-appbar--root` | – | new | Root app bar variant (hidden at `48rem+` when sidenav shown) |
| `ui-appbar--task` | – | new | Task bar: 44px Close, centered title, 44px Help; no wordmark |
| `ui-appbar__brand` | `ui-appbar__brand` | exists | Wordmark link (hidden at `<=23rem` after Back) |
| `ui-appbar__grow` | `ui-appbar__grow` | exists | Flex spacer |
| `ui-appbar__action` | `ui-appbar__action` | exists | 44px header button/link |
| `ui-appbar__help` | – | new | Help button hidden at `48rem+` |
| `ui-appbar__label` | – | new | Action text hidden below `40rem` |
| `ui-appbar__title` | – | new | Centered title inside `.ui-appbar--task` |
| `ui-mode-label` | `mode-choice` / `mode-mark` | renamed | Mode pill (`Concierge · Stays`) |
| `ui-mode-label--control` | – | new | Interactive 44px mode switcher trigger |
| `ui-mode-label__mark` | `mode-mark` | renamed | Mode colour square inside label |
| `ui-mode-label__prefix` | – | new | `"Concierge · "` hidden at `<=26rem` |
| `ui-mode-label__mode` | – | new | Mode name accented by `--mode-accent` |
| `ui-agent-mark` | `agent-mark` | renamed | 64-unit SVG mark (`ADR 0107`) |
| `ui-agent-mark__face` | – | new | Inner SVG face group |
| `ui-badge` | `ui-task-badge` / `agent-mark__badge` | renamed | Count badge on `warning-surface` |
| `ui-tabbar` | – | new | 3-tab mobile bottom bar (`Find`, `Your stays`, `Account`) |
| `ui-ask` | – | new | Footer wrapper around `.ui-composer--link` |
| `ui-composer--link` | – | new | Ask bar linking to concierge with page context |
| `ui-rail-nav` | `ui-rail-nav` | exists | 6-step journey bar wrapper |
| `ui-rail` | `ui-rail` | exists | 6-step desktop progress rail |
| `ui-rail-nav__compact` | – | new | Mobile compact `"Step N of 6 · Label"` |
| `ui-rail-nav__bar` | – | new | Compact segmented progress bar |
| `ui-sidenav` | `bo-header` (Operator) | renamed | Desktop side nav (`new` for guest) |
| `ui-sidenav--guest` | – | new | Guest side nav (`Find`, `Your stays`, `Account`, `Help`) |
| `ui-sidenav__brand` | – | new | Sidenav header brand + mode label |
| `ui-brand` | – | new | Display wordmark in sidenav |
| `ui-sidenav__list` | `bo-header__nav` | renamed | Vertical nav list |
| `ui-sidenav__list--end` | – | new | Footer nav list (`Help`) |
| `ui-sidenav__who` | `bo-header__who` | renamed | Signed-in identity caption |
| `ui-sidenav-compact` | – | new | Mobile `<details>` nav (Operator compact menu) |
| `ui-sidenav-compact__bar` | – | new | Compact bar header |
| `ui-sidenav-compact__section` | – | new | Current section label |
| `ui-sidenav-compact__toggle` | – | new | 44px Menu toggle |
| `ui-dialog` | `ui-dialog` (native `<dialog>`) | new | Modal dialog (Concierge chooser, etc.) |
| `ui-dialog__head` | – | new | Dialog header grid |
| `ui-dialog__title` | – | new | Dialog heading |
| `ui-dialog__actions` | – | new | Dialog footer buttons |

### Stay ticket, price breakdown, tiles & steps (`2b-03`)

| `ui-*` class | Current code class | Status | Notes |
| --- | --- | --- | --- |
| `ui-ticket` | `ui-ticket` | exists | Inverse booking ticket (`--color-surface-inverse`) |
| `ui-ticket__eyebrow` | `ui-ticket__label` | renamed | Uppercase sand eyebrow (`YOUR STAY`) |
| `ui-ticket__name` | `ui-ticket__name` | exists | Apartment title in ticket |
| `ui-ticket__dates` | `ui-ticket__dates` | exists | Check-in → check-out grid |
| `ui-ticket__date` | `ui-ticket__date` | exists | Check-in/out column |
| `ui-ticket__date--end` | `ui-ticket__date--end` | exists | Right-aligned checkout column |
| `ui-ticket__label` | `ui-ticket__label` | exists | Check-in / Check-out label |
| `ui-ticket__day` | `ui-ticket__day` | exists | Large Newsreader day number |
| `ui-ticket__time` | `ui-ticket__time` | exists | Arrival/checkout window time |
| `ui-ticket__arrow` | `ui-ticket__arrow` | exists | Sand arrow separator |
| `ui-ticket__foot` | `ui-ticket__foot` | exists | Nights · guests · booking reference |
| `ui-price-breakdown` | `ui-price-breakdown` | exists | Price summary panel |
| `ui-price-breakdown--band` | – | new | Dashed sand price band inside `.ui-ticket` |
| `ui-price-breakdown__condition` | `ui-price-breakdown__condition` | exists | Condition tag ("If your request is accepted") |
| `ui-price-breakdown__label` | `ui-price-breakdown__label` | exists | Total caption |
| `ui-price-breakdown__row` | `ui-price-breakdown__row` | exists | Line item (e.g. deposit) |
| `ui-price-breakdown__value` | `ui-price-breakdown__value` | exists | Newsreader money value |
| `ui-price-breakdown__due` | `ui-price-breakdown__due` | exists | Total due / this payment row |
| `ui-price-breakdown__paid` | `ui-price-breakdown__paid` | exists | Stay payment paid row |
| `ui-tiles` | `ui-tiles` | exists | 3-column stay fact tiles |
| `ui-tiles__tile` | `ui-tiles__tile` | exists | Individual tile |
| `ui-steps` | `ui-steps` | exists | Numbered "What happens next" list |
| `ui-steps--compact` | – | new | Compact variant |
| `ui-steps__number` | `ui-steps__number` | exists | Newsreader numeral in `sand-ink` |

### Result rows, list rows, view switch & stay cards (`2b-04`)

| `ui-*` class | Current code class | Status | Notes |
| --- | --- | --- | --- |
| `ui-segmented` | `ui-segmented` | exists | Extended with `<a>` view-switch variant (Concierge / List) |
| `ui-list` | `ui-list` | exists | Bordered list container |
| `ui-list__row` | `ui-list__row` | exists | 3-column interactive list row |
| `ui-list__row--static` | – | new | Non-interactive list row (no chevron) |
| `ui-list__primary` | `ui-list__primary` | exists | Primary row label |
| `ui-list__secondary` | `ui-list__secondary` | exists | Secondary row line |
| `ui-list__aside` | `ui-list__aside` | exists | Right-hand value/date |
| `ui-list__aside--money` | – | new | Newsreader money aside |
| `ui-list__status` | `ui-list__status` | exists | Status badge slot |
| `ui-result-rows` | `ui-result-rows` | exists | Stack of compact result rows |
| `ui-result-row` | `ui-result-row` | exists | Compact stay/plan row |
| `ui-result-row--muted` | – | new | Past/ended/closed muted row |
| `ui-result-row--no-thumb` | – | new | Row without thumbnail |
| `ui-result-row__thumb` | `ui-result-row__thumb` | exists | 64×48 thumbnail slot |
| `ui-result-row__body` | `ui-result-row__body` | exists | Row text column |
| `ui-result-row__title` | `ui-result-row__title` | exists | Row title |
| `ui-result-row__where` | `ui-result-row__where` | exists | Neighbourhood/dates subtitle |
| `ui-result-row__price` | `ui-result-row__price` | exists | Newsreader price figure |
| `ui-result-row__next` | – | new | Optional next-step status slot |
| `ui-stay-card` | `ui-stay-card` | exists | Discovery stay card |
| `ui-stay-card__media` | `ui-stay-card__media` | exists | 16:10 photo area |
| `ui-stay-card__photo` | `ui-stay-card__photo` | exists | Cover image |
| `ui-stay-card__photo--empty` | `ui-stay-card__photo--empty` | exists | Placeholder card |
| `ui-stay-card__count` | `ui-stay-card__count` | exists | `"1 / 7"` badge |
| `ui-stay-card__label` | `ui-chip--demo` over media | renamed | Demo listing badge over photo |
| `ui-stay-card__body` | `booking-details` / padding | renamed | Card body container |
| `ui-stay-card__where` | `ui-stay-card__where` | exists | Location row |
| `ui-stay-card__title` | `ui-stay-card__title` | exists | **Kit fix:** `min-height: 44px` |
| `ui-stay-card__facts` | `ui-stay-card__facts` | exists | Amenity chips row |
| `ui-stay-card__total` | `ui-stay-card__total` | exists | Total footer |

### Chat message, persona, chips, composer & multi-domain (`2b-05`)

| `ui-*` class | Current code class | Status | Notes |
| --- | --- | --- | --- |
| `ui-conversation` | `transcript-lane` | renamed | Chat column (`max-width: 460px`) |
| `ui-persona` | `turn-label` | renamed | Speaker header row |
| `ui-persona__mark` | `mode-mark` | renamed | 18×18 square mode mark |
| `ui-persona__mode` | – | new | Mode label in `--mode-accent` |
| `ui-persona--human` | – | new | **Kit fix:** 24×24 mark with `12px` initials (`Op`) |
| `ui-message` | `turn` / `bubble` | renamed | Assistant/operator message |
| `ui-message--guest` | `user` / `bubble` | renamed | Guest bubble (`--color-action-subtle`) |
| `ui-chips` | `ui-facts--chips` | renamed | Flex wrap chip bar |
| `ui-chip` | `ui-chip` | exists | 44px pill chip |
| `ui-chip--add` | `ui-chip--add` | exists | Add-filter chip |
| `ui-chip--demo` | `ui-chip--demo` | exists | Static demo tag |
| `ui-composer` | `composer` | renamed | Message composer pill |
| `ui-composer__input` | `.composer input` | renamed | 44px input |
| `ui-composer__send` | `.composer button` | renamed | 44×44 round send button |
| `ui-chooser` | `mode-choice` | renamed | Multi-domain concierge strip |
| `ui-chooser--dialog` | – | new | Chooser inside `<dialog>` |
| `ui-chooser__options` | – | new | Options grid |
| `ui-chooser__option` | – | new | Selectable mode option card |
| `ui-chooser__text` | – | new | Option title/line column |
| `ui-chooser__line` | – | new | Option description |
| `ui-domain-tag` | `ui-domain-chip` | renamed | Inline domain badge with `.ui-agent-mark` |
| `ui-switch-divider` | – | new | Horizontal divider announcing mode switch |
| `ui-switch-divider__text` | – | new | Centered switch announcement |

### Chat card, action bar, disclosure & panels (`2b-06`)

| `ui-*` class | Current code class | Status | Notes |
| --- | --- | --- | --- |
| `ui-chat-card` | `ui-panel` (in chat) | renamed | Read-only summary card in conversation linking to a page |
| `ui-chat-card__head` | – | new | Card header row |
| `ui-chat-card__title` | – | new | Card title |
| `ui-chat-card__aside` | – | new | Header metadata |
| `ui-chat-card__rows` | – | new | Linked rows list |
| `ui-chat-card__row` | – | new | 44px linked row with chevron |
| `ui-action-bar` | `ui-action-bar` | exists | Sticky/inline summary + primary CTA bar |
| `ui-action-bar__sum` | `ui-action-bar__sum` | exists | Money summary inside action bar |
| `ui-action-bar--sticky` | – | new | Sticky bottom bar on phones (`<48rem`) |
| `ui-confirm` | `ui-confirm` | exists | `<details>` disclosure confirm |
| `ui-confirm__body` | `ui-confirm__body` | exists | Disclosure body |
| `ui-effect` | – | new | "What this does" box inside disclosure |
| `ui-effect__title` | – | new | Effect title |
| `ui-effect__body` | – | new | Effect body |
| `ui-panel` | `ui-panel` | exists | Content surface card |
| `ui-panel--commit` | – | new | High-contrast ink-bordered commit panel |
| `ui-panel__title` | – | new | 19/26 panel heading |

### Operator shell, queue & transfer/receipt (`2b-07`)

| `ui-*` class | Current code class | Status | Notes |
| --- | --- | --- | --- |
| `ui-shell` | `bo-header` + main layout | renamed | Operator responsive shell (`sidenav` + `main`) |
| `ui-shell__main` | `container` | renamed | Operator main column (`max-width: 1040px`) |
| `ui-breadcrumb` | – | new | Operator detail breadcrumb |
| `ui-queue` | `bo-waiting` | renamed | Top-ruled queue list |
| `ui-queue-item` | `bo-waiting__item` | renamed | Deadline-sorted queue row (explicit comment in `bundle.css`) |
| `ui-queue-item__what` | – | new | Queue item text block |
| `ui-queue-item__kind` | – | new | Kind + overdue tag row |
| `ui-queue-item__title` | `bo-waiting__title` | renamed | Queue item heading |
| `ui-queue-item__detail` | – | new | Queue item detail line |
| `ui-queue-item__action` | – | new | Queue item action slot |
| `ui-outcome` | – | new | Operator action outcome box |
| `ui-outcome--success` | – | new | Confirmed outcome |
| `ui-outcome--declined` | – | new | Declined outcome |
| `ui-outcome__title` | – | new | Outcome heading |
| `ui-outcome__body` | – | new | Outcome text |
| `ui-transfer` | `bo-transfer` / `payment-manual` | renamed | Side-by-side transfer check layout (`>=48rem`) |
| `ui-transfer__side` | – | new | Transfer check column |
| `ui-reference` | `transfer-reference` / `bo-reference` | renamed | Monospace booking/bank reference |
| `ui-receipt` | `bo-receipt` | renamed | Receipt preview container |
| `ui-receipt__meta` | – | new | Upload timestamp/file metadata |
| `ui-receipt__frame` | `ui-image-frame` | renamed | 3:4 receipt image frame |
| `ui-receipt__label` | – | new | Badge over receipt |
| `ui-receipt__file` | – | new | Non-image (PDF) receipt card |
| `ui-receipt__name` | – | new | File name (`overflow-wrap: anywhere`) |
| `ui-receipt__gone` | – | new | Deleted-after-90-days box |

---

## 2. Board-only classes (`xk-*`, `bd-*`) — NEVER enter `apps/`

From [xenia-kit.css](xenia-kit.css) (36 classes). Per `kickoff.md` I3, a test/check must forbid these in `apps/`:

- **Board presentation furniture (`bd-*`):** `bd`, `bd-head`, `bd-frames`, `bd-br`, `bd-cell`, `bd-cap`, `bd-frame`, `bd-spec`, `bd-copy`, `bd-table`
- **Board-only screen layout helpers (`xk-*`):** `xk-head`, `xk-h2`, `xk-h3`, `xk-sec`, `xk-small`, `xk-note`, `xk-group`, `xk-stack`, `xk-owner`, `xk-money`, `xk-money--row`, `xk-choice`, `xk-gallery`, `xk-gallery__count`, `xk-gallery__all`, `xk-gallery__save`, `xk-photo`, `xk-viewer`, `xk-viewer__photo`, `xk-viewer__foot`, `xk-compare`, `xk-cards`, `xk-2col`, `xk-act`, `xk-scrim`, `xk-split`, `xk-chat`
  - Note: for gallery and comparison table in `apps/`, code already ships `.listing-gallery*` (`apps/local-guest/src/listing-gallery.ts`) and `.ui-compare*` (`apps/web/src/shortlet-foundations.css`).

---

## 3. Existing code-only classes to preserve unless replaced

From `apps/web/src/shortlet-foundations.css` (keep when porting unless a board explicitly replaces them per `map.md` / `kickoff.md` §6):

- **Kit/page helpers still in code:** `ui-button--destructive`, `ui-compare`, `ui-compare__cell`, `ui-compare__head`, `ui-compare__key`, `ui-compare__row`, `ui-compare__row--head`, `ui-display`, `ui-domain-chip`, `ui-empty__art`, `ui-eyebrow`, `ui-fact`, `ui-facts--chips`, `ui-icon-button`, `ui-image-frame`, `ui-money-detail`, `ui-money-metadata`, `ui-page--narrow`, `ui-page__header`, `ui-readable`, `ui-row`, `ui-serif`, `ui-skip-link`, `ui-sr-only`, `ui-stack`, `ui-stale`, `ui-status--neutral`, `ui-status--stale`, `ui-step-header`, `ui-step-header__status`, `ui-task-badge`, `ui-task-rail`, `ui-task-rail-nav`, `ui-task-rail__item`, `ui-task-rail__item--current`, `ui-task-rail__status`, `ui-upload`, `ui-vertical-starter`, `ui-vertical-starter__description`, `ui-vertical-starter__title`, `ui-vertical-starters`
- **Page/client hooks:** `agent-dock`, `agent-dock__chip`, `agent-mark`, `agent-mark__badge`, `app`, `bank-details`, `booking-details`, `bubble`, `composer`, `confirmed-screen`, `guest-editorial`, `mode-choice`, `mode-mark`, `no-js-conversation`, `no-js-surface-fallback`, `no-js-transcript`, `offer-actions`, `offer-head`, `offer-policies`, `offer-screen`, `payment-actions`, `payment-choice`, `payment-choice-form`, `payment-choice-methods`, `payment-head`, `payment-manual`, `payment-screen`, `payment-steps`, `receipt-marker`, `request-actions`, `request-deadline`, `request-guests`, `request-head`, `request-next`, `request-notes`, `request-provider`, `request-screen`, `stay-card`, `stay-grid`, `test`, `transcript-lane`, `transfer-account`, `transfer-copy`, `transfer-copy-status`, `transfer-reference`, `transfer-summary`, `ts`, `turn`, `turn-label`, `user`, `waiting-countdown`, `weaver-mount`
