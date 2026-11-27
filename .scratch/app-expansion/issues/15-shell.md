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

### Verification

- `npm run build && npm run check` — clean (TypeScript + Cloudflare Worker bundle guard).
- `npx tsx --test test/guest-shell.test.ts test/guest-navigation.test.ts test/round12-class-parity.test.ts test/assistant-cold-journey.test.ts test/guest-plans-page.test.ts test/guest-brand-xenia.test.ts test/guest-ui-kit.test.ts test/guest-account-pages.test.ts test/guest-account-sign-in.test.ts test/guest-account-page.test.ts test/guest-retired-classes.test.ts` — **143/143 passed** (`guest-shell.test.ts` 5/5, `guest-navigation.test.ts` 5/5, `round12-class-parity.test.ts` 5/5, `assistant-cold-journey.test.ts` 4/4, `guest-plans-page.test.ts` 7/7, `guest-brand-xenia.test.ts` 2/2).
- Chrome walkthrough captures saved under `.scratch/guest-ui-consistency/screenshots/shell/` (`390` and `1280`, light & dark, all 7 screens).

### Walkthrough Comparison Table (Round 12 Boards vs Running App)

| Screen | Board matched | What matches | Differences from board (with reason) |
| --- | --- | --- | --- |
| Start page (`/`) | `Main.dc.html` (Find / Chat start) | Mobile Tab bar (`Find` active, `Your stays`, `Account`), Desktop `SideNavigationGuest` (`Xenia`, `Concierge · Stays`, `Find`, `Your stays`, `Account`), `Find a place to stay`, `Explore Abuja` / `Explore Lagos` starters, composer (`Your message`, `Area, dates, guests`). | Inner `.app` keeps its own `<header>` (`Xenia`, `New` / `New conversation` button) alongside desktop sidebar so existing conversation controls stay unchanged ("Keep as is" in `Handover.dc.html`); single-domain `Concierge · Stays` label without domain switcher (D13 / issue 24 not built yet); no `Tolu from the Xenia team` persona copy (unapproved copy held back). |
| Search result (`/` after search) | `Main.dc.html` (Search results in chat) | Mobile Tab bar (`Find` active), Desktop `SideNavigationGuest`, Journey rail (`Step 1 of 6 · Search`), compact `ui-result-row` list on 390, 2-column conversation + discovery workspace split on 1280, criteria strip (`Edit search` / chips), composer. | `Show this search as` / `Save` / `Saved` controls omitted (unapproved copy / phase 5 not built yet); `Photo coming soon` replaced by existing `Photos not available` (unapproved copy held back). |
| Apartment (`/stays/:unitId`) | `Main.dc.html` / `Handover.dc.html` (Stay detail state) | Mobile Tab bar (`Find` active), Desktop `SideNavigationGuest`, Back app bar (`Concierge · Stays`), Journey rail (`Step 2 of 6 · Stay`), Ask bar (`Ask about this stay` -> `/?context=stay:<id>`), existing unit tiles & indicative price. | Single-domain `Concierge · Stays` only (no multi-domain switcher); `Save` button omitted (phase 5 not built yet); `Photos are not available for this apartment yet.` kept over `Photo coming soon` (unapproved copy held back). |
| Review request (`/booking-requests/drafts/:id`) | `TaskRail.dc.html` (Task bar) | `TaskBar` (`Close Request Draft` X link, `Request Draft` title, no Tab bar, no Ask bar, no SideNav), Journey rail (`Step 3 of 6 · Request`), Stay ticket, price breakdown, sticky action bar (`Review request`). | `Help` link in `TaskBar` omitted until issue 16 (`Help` screen) is built (D6 contact facts pending). |
| `/plans` (empty) | `Domains.dc.html` ("Your plans" empty) | Mobile Tab bar (`Your stays` active), Desktop `SideNavigationGuest` (`Your stays` active), `Your stays` `<h1>`, empty state card (`No stays yet`, `Find a stay`), Ask bar (`Ask about your stays` -> `/?context=plans`). | Title & tab say `Your stays` instead of `Your plans` (D10: single registered domain `Stays`); no `This device` / `Another device` split (D8 / guest-accounts 13 not built yet). |
| `/plans` (with request) | `Domains.dc.html` ("Your plans" list) | Mobile Tab bar (`Your stays` active), Desktop `SideNavigationGuest`, `Your stays` `<h1>`, `In progress` section with `ui-list__row` (`Luxury 2-Bedroom Apartment in Old Ikoyi`, dates, status, deadline), Ask bar (`Ask about your stays` -> `/?context=plans`). | Single-domain stays list only (no multi-domain filter); `1 needs your action` badge appears only on `needsAction` stages (e.g. pending offer), not waiting-for-operator `pending` requests (D10 / rules 02). |
| Account (`/account`) | `Account.dc.html` | Mobile Tab bar (`Account` active), Desktop `SideNavigationGuest` (`Account` active), `Your account` `<h1>`, `Your details` (email, phone, identity status), `Change email`, `Phone number`, sign-out actions, Ask bar (`Ask the concierge` -> `/`). | `Help` link omitted until issue 16 (D6 contact facts pending); `Download my data` / `Delete my account` actions omitted (unapproved copy / not built yet). |

### Strings Held Back (Unapproved Copy)
- `Tolu from the Xenia team`, `Photo coming soon`, `Show this search as`, `Save` / `Saved`, `Continue to secure payment`, `This device` / `Another device`, `Download my data` / `Delete my account`, and `Your plans` (held for multi-domain per D10).
