# Desktop split, dark mode and the final visual acceptance

Status: ready-for-agent
Type: task
Blocked by: 05, 06, 07, 08, 09, 10
Requested: 29 Sept 2026

## Why

The earlier issues build the screens. This one makes sure the whole app matches the approved design at every width and in both themes, and removes what the kit replaced.

## What to build

- **Desktop split** (`design/DesktopDiscovery`, `DesktopReview`, `DesktopPayment`, `DesktopConfirmed`):
  - the conversation column (~460px) beside the workspace, which has a 560px reading width (discovery: two stay cards per row)
  - the app bar and rail span the full width
  - tune the existing split-workspace layout in `renderGuestShellHtml`; don't rebuild it
- **Dark mode:**
  - walk every screen with `prefers-color-scheme: dark` and with `data-theme="dark"`, and compare against `design/renders/*-dark.png`
  - the ticket uses `#0E2A21` with a visible `#2F6B55` border and mint accents, from the tokens
- **Clean-up:**
  - delete the page-level `style:` strings, shell-local rules and client classes the kit replaced: `.waiting-panel*`, `.stay-result`, the old `.stay-card*` if they're unused, `GUEST_STAY_PAYMENT_STYLE`
  - a test asserts the old class names no longer appear in rendered guest HTML
- **Docs:** update `docs/design/shortlet-design-system-direction.md` with the kit component list, and link the canvas.

## Acceptance criteria

- AC1: At 1280px, the chat shows the conversation and workspace side by side, the workspace content is at most 560px wide (discovery 760px), and nothing overlaps (real Chromium, for the four desktop designs).
- AC2: Every screen from `design/` has a matching capture at 320, 390, 768 and 1280, in light and dark, saved under `.scratch/guest-ui-consistency/screenshots/final/`, with no horizontal scroll and no control under 44px. Use `capture.ts`, extended with a dark pass and the 44px check from `design/check.mts`.
- AC3: A side-by-side review against `design/renders/` finds no screen using a component outside the kit. List any intentional difference in `## Answer`, with the reason.
- AC4: The retired classes and style strings are gone from the source and from rendered HTML (test), and `npm run check` and the full `npm test` pass (report the counts).
- AC5: At 200% zoom and with reduced motion on, the request review and payment choice screens reflow without clipping and have no motion (Chromium `setReducedMotion`).

## Notes

- Ask the user to review the final captures before marking this resolved.
- The full `npm test` takes about 12 minutes in the browser phase. Run it in the background with a long timeout, not under a 2-minute limit.

## ADR compliance

0078 (all of it), 0080.

## Comments
