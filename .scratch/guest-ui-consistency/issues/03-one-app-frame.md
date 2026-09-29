# One app frame: top bar and journey rail everywhere; chat shell on foundation tokens

Status: ready-for-agent
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
