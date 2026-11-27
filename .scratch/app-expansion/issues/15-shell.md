# Tab bar, Ask bar, task bar and desktop rail

Status: resolved
Type: task
Blocked by: 11 (shell strings approved by the owner 27 Nov 2026: tab and side navigation labels, the badge text, the Ask bar labels including "Ask the concierge", "Close {task}" and "Help"; D10 and D13 accepted; 07, 08, 12 resolved)

## What to build

- The published components only (issue 08), in the shared kit CSS and `guest-kit.ts`, used by the chat shell and the standard pages.
- Section pages: tab bar and Ask bar. Task pages: task bar, no tab bar. 48rem and wider: the guest side navigation, with the existing conversation split kept.
- The Ask bar is a link that opens the conversation with a server-known context reference. It carries no text and no authority.
- Back, focus, safe areas and the phone keyboard: the tab bar must not cover a field or sit above the keyboard.
- With one registered domain, nothing about other domains renders.

## Acceptance criteria

- AC1: The navigation table (issue 12) has no remaining Help or list gap.
- AC2: The share of height left for content at 320×568 is measured and accepted by the owner before the rest is built (the prototype leaves about 71% at 320×640).
- AC3: Keyboard, screen reader and Android Back reach and leave every section and task.
- AC4: Closing a task sends no command.
- AC5: A forged or stale Ask context opens a plain conversation.
- AC6: With no JavaScript, tabs and tasks work as links and pages.
- AC7: Captures at four widths, two themes.

## ADR compliance

0074, 0078, 0080, 0106, 0107.

## Comments

### 320×568 Content Share (AC2)

Measured in real Chromium at `320×568` (light & dark):
- **`/` (Find / chat start)**: App bar `59 px`, Ask bar `0 px` (chat owns the composer), Tab bar `50 px` → `109 px` chrome, **`459 px` content (80.8% of 568 px)**.
- **`/plans` (Your stays, empty & with request)**: App bar `53 px`, Ask bar `49 px`, Tab bar `50 px` → `152 px` chrome, **`416 px` content (73.2% of 568 px)**.
- Zero horizontal overflow (`scrollWidth <= innerWidth`) and zero interactive controls under `44×44 px` across `320`, `390`, `768`, and `1280` (light & dark).

### Verification (Full Gate Remediation)

- `npm run build` — clean (`apps/local-guest/dist/client.js` rebuilt after `client.ts` `headingTag: "h2"` parity fix).
- `npm run check` — clean (`tsc --noEmit` across root, `apps/cloudflare`, `tsconfig.test.json`, `tsconfig.tooling.json`, and `scripts/check-worker-bundle.mjs`).
- `npm run test:workers` — **30/30 files, 198/198 tests passed**.
- Solo fixed/remediated Phase 1 & Phase 2 files:
  - `test/guest-shell.test.ts` + `test/guest-ui-kit.test.ts`: **10/10 passed**
  - `test/guest-account-page-chromium.test.ts`: **5/5 passed**
  - `test/guest-account-sign-in-chromium.test.ts`: **2/2 passed**
  - `test/guest-offer-consistency-chromium.test.ts`: **5/5 passed**
  - `test/guest-payment-consistency-chromium.test.ts`: **3/3 passed**
  - `test/guest-shell-chromium.test.ts`: **3/3 passed**
  - `test/round12-2b-06.test.ts`: **7/7 passed**
  - `test/guest-journey-rail.test.ts`: **8/8 passed**
  - `test/guest-app-frame-chromium.test.ts`: **2/2 passed**
  - `test/guest-container-queries-chromium.test.ts`: **3/3 passed**
  - `test/guest-final-acceptance-chromium.test.ts`: **3/3 passed**
  - `test/guest-split-workspace-chromium.test.ts`: **3/3 passed**
  - `test/round12-2b-02.test.ts`: **3/3 passed**
  - `test/round12-2b-05.test.ts`: **7/7 passed**
  - `test/mobile-guest-journey-chromium.test.ts`: **43/43 passed**
  - Remaining 13 Phase 1 updated files (`agent-mark-shell`, `agent-mode-follows-task`, `agent-mode-shell`, `card-checkout-after-email`, `commerce-store-routes`, `guest-app-frame`, `guest-contact-pilot`, `guest-focus-announcements`, `guest-kit`, `guest-offer-payment-clarity`, `landing-handoff`, `local-guest-shell`, `local-guest-weaver-demo`): **120/120 passed**
- Full `npm test`:
  - Phase 1 (concurrent, 476 files): **3,647/3,651 passed** (4 failures were concurrent-load flakes that all passed solo: `test/model-quota-host-recovery.test.ts` **12/12**, `test/shortlet-catalogue-manifests.test.ts` **5/5**, `test/guest-cross-tab-concurrency.test.ts` **18/18**).
  - Phase 2 (real Chromium, 61 files): **58/61 files passed, 0 timed out** (**307/314 tests passed**); the 3 failing files were the 2 accepted commerce browser files (`test/commerce-store-pages.real-browser.test.ts`, `test/commerce-surfaces-chromium.test.ts`) and 1 load flake (`test/listing-gallery-chromium.test.ts`, which passed **6/6** solo).
- Chrome walkthrough captures re-run under `.scratch/guest-ui-consistency/screenshots/shell/` (`390` and `1280`, light & dark, all 7 screens: `start`, `search-result`, `apartment`, `review-request`, `plans-empty`, `plans-request`, `account`): **28/28 passed** with `overflow=0`, `h1=1`, and zero controls under `44×44 px`.

### Full Gate Failure Classification Table (`03475c8`)

| Test file | Class | Root cause & authority / fix |
| --- | --- | --- |
| `test/agent-mark-shell.test.ts` | (a) | Pinned `<span>Shortlet</span>` in app bar; updated to `<span>Xenia</span>` per D14 / issue 30. |
| `test/agent-mode-follows-task.test.ts` | (a) | Pinned pre-shell HTML snapshot `guest-shell-pre-agent-modes.html`; regenerated snapshot from `renderGuestShellHtml()` (issue 15, D14) keeping `data-mode="stays"` check. |
| `test/agent-mode-shell.test.ts` | (a) | Pinned pre-shell HTML snapshot `guest-shell-pre-agent-modes.html`; passes with regenerated snapshot (issue 15, D14). |
| `test/card-checkout-after-email.test.ts` | (a) | Pinned `"You will leave Shortlet temporarily..."`; updated to `"You will leave Xenia..."` per D14 / issue 30. |
| `test/commerce-store-routes.test.ts` | (a) | Pinned `>Shortlet<` on `/orders/track`; updated to `>Xenia<` per D14 / issue 30. |
| `test/guest-app-frame.test.ts` | (a) | Pinned legacy `ui-icon-button` & `"Back to your conversation"` on all standalone pages; updated AC1 to match Issue 15 `AppBar` / `TaskBar` / `SideNavigationGuest` READMEs while keeping 6-step rail and no-invented-`threadId` checks. |
| `test/guest-contact-pilot.test.ts` | (a) | AC26/AC27 pinned `ui-page ui-page--narrow`; updated to `ui-app__main ui-app__main--task` per Issue 15 `TaskBar` shell while keeping `ui-field`, CSS, and `tel`/`email` assertions. |
| `test/guest-focus-announcements.test.ts` | (a) | Pinned `aria-label="Shortlet home"><span>Shortlet</span>`; updated to `Xenia` per D14 / issue 30 while keeping sole-H1 and non-heading brand checks. |
| `test/guest-journey-rail.test.ts` | (a) | Pinned `no-js-journey` class and no `aria-current` anywhere on page; updated to shared `.ui-rail-nav` and `aria-current="step"` check (SideNav/TabBar carry `aria-current="page"`, Issue 15 `railHtml`). |
| `test/guest-kit.test.ts` | (a) | Pinned `>Shortlet<` in default `appBarHtml`; updated to `>Xenia<` per D14 / issue 30. |
| `test/guest-offer-payment-clarity.test.ts` | (a) | Pinned `/contact Shortlet/i`; updated to `/contact Xenia/i` per D14 / issue 30. |
| `test/landing-handoff.test.ts` | (a) | Pinned `/Shortlet beta/`; updated to `/Xenia beta/` per D14 / issue 30. |
| `test/local-guest-shell.test.ts` | (a) | Pinned inline `100dvh` in shell `<style>`; updated to assert `class="ui-app"` (`100dvh` lives in `shortlet-foundations.css` on `body > .ui-app:not(.ui-page)`). |
| `test/local-guest-weaver-demo.test.ts` | (a) | Pinned `"Shortlet"` and `"Abuja · Lagos"` in shell HTML; updated to `"Xenia"` (D14) and `"Concierge"` / `"Stays"` (Issue 15 `AppBar` README). |
| `test/shortlet-catalogue-manifests.test.ts` | Flake | Concurrent-load `fetch failed`; passes **5/5** solo. |
| `test/model-quota-host-recovery.test.ts` | Flake | Known concurrent-load flake (`AGENTS.md`); passes **12/12** solo. |
| `test/guest-account-page-chromium.test.ts` | (b) | Real regression: `<p><a href="/account">Back to your account</a></p>` on email-change code step was <44px tall; fixed in `guest-account-pages.ts` with `ui-button ui-button--quiet ui-button--block` (ADR 0078). |
| `test/guest-account-sign-in-chromium.test.ts` | (b) | Real regression: `<p><a href="/account">Back to your account</a></p>` on sign-in code step was <44px tall; fixed in `guest-account-pages.ts` with `ui-button ui-button--quiet ui-button--block` (ADR 0078). |
| `test/guest-app-frame-chromium.test.ts` | (a) | AC5 pinned `.ui-appbar .ui-icon-button`; updated to `.ui-appbar .ui-appbar__action` (Issue 15 `TaskBar` README) while keeping full no-JS back-link navigation test. |
| `test/guest-container-queries-chromium.test.ts` | (a) & (b) | Pinned `main.ui-page` (updated to `main.ui-app__main`, Issue 15) + real CSS regression: `.ui-app__main` lacked `container-type: inline-size;` (`shortlet-foundations.css`). |
| `test/guest-final-acceptance-chromium.test.ts` | (a) | AC1 pinned `.ui-appbar` alone spanning 1280px; updated to verify `.ui-sidenav` + `.ui-appbar` together span full width while keeping split-workspace width, overlap, and 200%/400% zoom checks. |
| `test/guest-offer-consistency-chromium.test.ts` | (b) | Real regression: `client.ts` called `offerScreenHtml` without `{ headingTag: "h2" }`, causing `<h1>` vs `<h2>` parity mismatch and duplicate `<h1>` on `/` (ADR 0078, ADR 0080). Fixed in `client.ts` + rebuilt `dist/client.js`. |
| `test/guest-payment-consistency-chromium.test.ts` | (b) | Real regression: `client.ts` called `paymentScreenHtml` without `{ headingTag: "h2" }`, causing `<h1>` vs `<h2>` parity mismatch and duplicate `<h1>` on `/` (ADR 0078, ADR 0080). Fixed in `client.ts` + rebuilt `dist/client.js`. |
| `test/guest-split-workspace-chromium.test.ts` | (a) | AC3 pinned `"Ask Shortlet"` button; updated to `"Ask the concierge"` per `copy-decisions.md` (approved by owner, 27 Nov 2026). |
| `test/mobile-guest-journey-chromium.test.ts` | (a) & (b) | AC31 pinned `"Contact details"` link removed from chat header to Account/shell (`Main.dc.html` / Issue 15); updated to `"Account"` link + added explicit check that exactly one `"Main"` navigation landmark is exposed; fixed `.ui-sidenav` `@media (min-width: 48rem)` mutual exclusion in `shortlet-foundations.css`. |
| `test/round12-2b-02.test.ts` | (a) & (b) | Real regressions in `shortlet-foundations.css`: `body > .ui-app` stretched `.ui-page.ui-app` appbar to 504px (fixed with `:not(.ui-page)`), and `.ui-rail-nav` `@container (min-width: 40rem)` kept compact rail at 768px beside 14.5rem SideNav (fixed to `30rem`). Also updated stale `I4` regex (`/plans` and `Close {task}` approved in `copy-decisions.md` 27 Nov 2026; `>Xenia<` per D14). |
| `test/round12-2b-05.test.ts` | (a) | `I4` banned `"Ask the concierge"`, which was approved by the owner on 27 Nov 2026 (`copy-decisions.md` line 29); removed that ban while keeping `Tolu from the` banned. |
| `test/round12-2b-06.test.ts` | (b) | Real CSS regression: `.ui-app__main` lacked `container-type: inline-size;`, so `@container (min-width: 48rem)` on `.ui-action-bar--sticky` measured `.ui-app` (1280px) instead of `.ui-app__main--task` (40rem), making the sticky bar `static` (`shortlet-foundations.css`). |
| `test/commerce-store-pages.real-browser.test.ts` | Accepted | Known accepted failure while commerce is not shipping (`AGENTS.md`). |
| `test/commerce-surfaces-chromium.test.ts` | Accepted | Known accepted failure while commerce is not shipping (`AGENTS.md`). |

### Walkthrough Comparison Table (Round 12 Boards vs Running App — Redone at 390 & 1280, Light & Dark)

| Screen | Board matched | What matches (390 & 1280, light & dark) | Differences from board (with reason) |
| --- | --- | --- | --- |
| Start page (`/`) | `Main.dc.html` (Find / Chat start) | Mobile Tab bar (`Find` active, `Your stays`, `Account`), Desktop `SideNavigationGuest` (`Xenia`, `Concierge · Stays`, `Find`, `Your stays`, `Account`), sole `<h1>` (`Find a place to stay`), `Explore Abuja` / `Explore Lagos` starters, composer (`Your message`, `Area, dates, guests`). Zero overflow, all controls >=44px. | Inner `.app` keeps its own `<header>` (`New` / `New conversation` button) alongside desktop sidebar so existing conversation controls stay unchanged ("Keep as is" in `Handover.dc.html`); single-domain `Concierge · Stays` label without domain switcher (D13); no `Tolu from the Xenia team` persona copy (unapproved copy held back). |
| Search result (`/` after search) | `Main.dc.html` (Search results in chat) | Mobile Tab bar (`Find` active), Desktop `SideNavigationGuest`, compact/full Journey rail (`Step 1 of 6 · Search`), compact `ui-result-row` list on 390, 2-column conversation + discovery workspace split on 1280, criteria strip (`Edit search` / chips), composer. Zero overflow, all controls >=44px. | `Show this search as` / `Save` / `Saved` controls omitted (unapproved copy / phase 5 not built yet); `Photo coming soon` replaced by existing `Photos not available` (unapproved copy held back). |
| Apartment (`/stays/:unitId`) | `Main.dc.html` / `Handover.dc.html` (Stay detail state) | Mobile Tab bar (`Find` active), Desktop `SideNavigationGuest`, Back app bar (`Concierge · Stays`), Journey rail (`Step 2 of 6 · Stay`), Ask bar (`Ask about this stay` -> `/?context=stay:<id>`), existing unit tiles & indicative price, sole `<h1>`. Zero overflow, all controls >=44px. | Single-domain `Concierge · Stays` only (no multi-domain switcher); `Save` button omitted (phase 5 not built yet); `Photos are not available for this apartment yet.` kept over `Photo coming soon` (unapproved copy held back). |
| Review request (`/booking-requests/drafts/:id`) | `TaskRail.dc.html` (Task bar) | `TaskBar` (`Close Request Draft` X link, `Request Draft` sole `<h1>`, no Tab bar, no Ask bar, no SideNav), Journey rail (`Step 3 of 6 · Request`), Stay ticket, price breakdown, sticky action bar (`Review request`). Zero overflow, all controls >=44px. | `Help` link in `TaskBar` omitted until issue 16 (`Help` screen) is built (D6 contact facts pending). |
| `/plans` (empty & with request) | `Domains.dc.html` ("Your plans") | Mobile Tab bar (`Your stays` active), Desktop `SideNavigationGuest` (`Your stays` active), `Your stays` sole `<h1>`, empty state card (`No stays yet`, `Find a stay`) or `In progress` `ui-result-rows` without list markers, Ask bar (`Ask about your stays` -> `/?context=plans`). Zero overflow, all controls >=44px. | Title & tab say `Your stays` instead of `Your plans` (D10: single registered domain `Stays`); no `This device` / `Another device` split (D8 / guest-accounts 13 not built yet); `1 needs your action` badge appears only on `needsAction` stages (D10 / rules 02). |
| Account (`/account`) | `Account.dc.html` | Mobile Tab bar (`Account` active), Desktop `SideNavigationGuest` (`Account` active), `Your account` sole `<h1>`, `Your details` (email, phone, identity status), `Change email`, `Phone number`, sign-out actions, Ask bar (`Ask the concierge` -> `/`). Zero overflow, all controls >=44px. | `Help` link omitted until issue 16 (D6 contact facts pending); `Download my data` / `Delete my account` actions omitted (unapproved copy / not built yet). |

### Strings Held Back (Unapproved Copy)
- `Tolu from the Xenia team`, `Photo coming soon`, `Show this search as`, `Save` / `Saved`, `Continue to secure payment`, `This device` / `Another device`, `Download my data` / `Delete my account`, and `Your plans` (held for multi-domain per D10).
