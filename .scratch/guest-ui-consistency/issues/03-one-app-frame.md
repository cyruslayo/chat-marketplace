# One app frame: top bar and journey rail everywhere; chat shell on foundation tokens

Status: resolved
Type: task
Blocked by: 02
Requested: 29 Sept 2026

## Why

In the design, every screen carries the same top bar (back button or "New conversation", with the serif "Shortlet" wordmark) and the same journey rail. Today only the chat has a rail, and it is styled with shell-local variables (`--accent` for the current step, `--surface`, `--border`). Standalone pages have no frame at all, so leaving the chat feels like leaving the product.

## What to build

- **Standalone pages.** Every guest page built on `pageShell` gets `appBarHtml` and `railHtml`:
  - the conventional booking pages, search, unit detail, the payment page, both transfer pages and the manual-transfer states
  - the back control links to `/?threadId=<id>` when the page has a thread, otherwise to `/`
  - rail state: use the thread's journey (`#journeyFor(thread)` in `guest-server.ts`, built on `projectJourney` in `journey-rail.ts`) wherever the page resolves a thread. The public pages without a thread (`/stays/search`, `/stays/:id`) show the Search or Stay step as current. Don't invent stages.
- **Chat shell** (`renderGuestShellHtml`):
  - the header becomes `.ui-appbar`: brand, plus the "New conversation" pill with its icon
  - `#journey-rail` renders `.ui-rail`: keep the element ids and `data-state` attributes that `client.ts` and the tests use. Current uses the action colour; failed keeps warning/danger
  - `#criteria-strip` chips use `.ui-chip`, with `.ui-chip--add` (dashed, plus icon) for an empty criterion
  - the bubbles, marker and composer follow `design/ChatHome.dc.html` and `ChatResults.dc.html`
- **Delete the shell-local colour variables.** Remove `--accent`, `--surface`, `--border` and similar from the shell `<style>` and use the foundation tokens directly. The chat and the pages then share one palette in both themes.

## Design references

`design/ChatHome`, `ChatResults` (chat frame); `design/RequestReview` and any standalone artboard (page frame); `design/Main.dc.html` (app frame, chips).

## Acceptance criteria

- AC1: Every standalone guest page listed above renders the app bar and the journey rail, and the back control points to the page's own conversation, or to `/` without a thread.
- AC2: For a given thread, the rail on a standalone page shows the same steps and states as the chat's rail. This is a parity test over the walkthrough stages, including a failed outcome (declined or expired).
- AC3: The chat shell's CSS defines no colour of its own: no hex values and no shell-local colour custom properties. A test inspects the `renderGuestShellHtml` style block.
- AC4: At 320px, no page or the chat scrolls sideways, and every control in the app bar, rail and criteria strip is at least 44px tall (real Chromium).
- AC5: With JavaScript disabled, the back control and the rail render and the back link works (real Chromium, `setJavaScriptEnabled(false)`).

## Tests to update

`guest-journey-rail.test.ts`, `guest-journey-rail-chromium.test.ts`, `guest-criteria-strip-chromium.test.ts`, `guest-no-js-composer-chromium.test.ts`, `guest-waiting-states-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`. Update only class and structure assertions; behaviour assertions stay.

## ADR compliance

0078 (targets, reflow, focus), 0080 (no-JS frame), 0072 (the rail stays a projection, with no client-invented state).

## Comments

## Answer

Landed on `ui/guest-consistency`.

- **Standalone frame (AC1).** `pageShell` takes an optional `frame` placed before `<main>`. `guest-kit.ts` `appFrameHtml({ threadId, journey, publicStep })` = app bar (back icon button "Back to your conversation", serif "Shortlet" wordmark) + `railHtml`. Wired into the conventional booking pages (draft, request, offer, contract), search, unit detail, the payment page, both transfer pages and every manual-transfer state. Back goes to `/?threadId=<id>` when the page resolves a thread, else `/`. Public pages show `projectJourney("search")` or `("stay")`, nothing else. `LocalGuestApp.journeyForThread` is a new owner-checked read (ADR 0070) used by the payment and transfer pages; the booking pages carry `journey` on `ConventionalBookingPage` from `#journeyFor(thread)`.
- **Chat shell (AC3).** The header is `.ui-appbar` with the icon "New conversation" pill (accessible name and `#new-conversation` id unchanged); `#journey-rail` is `.ui-rail-nav` > `ol.ui-rail`, and `client.ts` builds the same `li[data-step][data-state][data-tone]` and `ui-sr-only` state text as `railHtml`; empty criteria chips are dashed `ui-chip--add` chips with a plus icon; the guest bubble uses the action colour and the concierge bubble a bordered surface. `:root { --bg --surface --border --accent ... }` is gone and the shell reads `--color-*` tokens directly. The no-JS conversation page referenced `--surface-soft`, which was never defined; it now uses `--color-surface-subtle`.
- **Rail reflow.** `.ui-rail` is six columns, and three columns x two rows below 23rem, so 320px never crams "Confirmed". Failed steps are warning-coloured, danger when `data-tone="danger"` (as before).
- **Tests.** `test/guest-app-frame.test.ts` (AC1 across eight stage pages and the two public pages; AC2 parity of the page rail with the chat's `/api/state` journey, including a failed outcome: the expired offer; AC3 shell has no hex and no shell-local colour variable or use, plus the shared-component check) and `test/guest-app-frame-chromium.test.ts` (AC4 at 320px: no sideways scroll, app bar/rail/criteria controls >= 44px; AC5 JavaScript off: rail and back link render and the link navigates). Shared helper `test/helpers/guest-stage-pages.ts` (also used by later issues). Updated only structure assertions: `guest-new-conversation.test.ts` expects the new button markup.
- **Verification.** `npm run check` clean. `npm test`: phase 1 1191/1191; phase 2 130 pass, 1 fail, 1 skip. The failure, `listing-gallery-chromium` AC3, hit its 10s wait under full-suite load and passes 5/5 when run alone. Screenshots: `screenshots/03/`.

## Comments

ADRs: 0078 (44px targets, 320px reflow, focus), 0080 (frame and back link work with JavaScript off; rail is a server render), 0072 (rail is only a projection; the client builds no state), 0070 (`journeyForThread` fails closed to undefined for anyone else's thread). Not done here on purpose: the no-JS conversation page (`renderNoScriptConversationHtml`) keeps its own header and `no-js-journey` rail until issue 10, and the local demo payment page is a pilot-only form.
