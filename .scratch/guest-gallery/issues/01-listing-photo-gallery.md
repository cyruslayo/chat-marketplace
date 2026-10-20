# A listing photo gallery that works on phones and wide screens

Status: resolved
Type: task
Blocked by: none
Requested: 28 Sept 2026

## Why

Guests judge an apartment by its photos. Today there are two different galleries:

- **The chat's apartment details** (`organizeUnitDetail` in `apps/local-guest/src/client.ts`) stack the photos, or on wide screens show the cover with a 2-column grid under it.
- **The full apartment page** (`renderConventionalUnitDetailHtml` in `apps/local-guest/src/guest-server.ts`) renders a plain grid.

Neither lets a Guest swipe through the photos on a phone, see them large, or step through them. With up to 12 photos (`MAX_UNIT_PHOTOS`), a phone page becomes a long scroll of photos before the facts.

## Decision (28 Sept 2026)

- **Phones: a swipe strip.** Photos form a swipeable strip, one photo at a time, with a "Photo X of N" count.
- **Wide screens: a mosaic.** The cover is large, beside a 2×2 grid of the next four photos. "Show all N photos" opens the viewer, and the fifth tile shows "+K" when there are more.
- **Full-screen viewer.** Any photo opens it, as does "Show all". It has previous and next buttons, arrow keys and swipe, an "X of N" count, and closes with Esc, a close button or a tap outside.
- **One gallery for both surfaces.** The same markup, styles and script serve the chat panel and the full page.

## Acceptance criteria

- AC1: On phones (below 48rem), the apartment's photos form a swipeable strip, one photo at a time in their stored order, with a "Photo X of N" count that follows the swipe. The page does not scroll sideways at 320px.
- AC2: On wider screens, the gallery shows the cover large beside up to four more photos. With more than five photos, the fifth shows "+K more" and a "Show all N photos" button appears.
- AC3: Tapping a photo, or "Show all", opens a full-screen viewer at that photo, with previous and next buttons, arrow keys, swipe and an "X of N" count. Esc, the close button or a tap outside closes it, and focus returns to what opened it.
- AC4: Without JavaScript, every photo is still shown in its stored order, and each links to the full-size image. The page and Request to Book stay usable.
- AC5: The full apartment page and the chat's apartment details use the same gallery. A photo that fails to load still shows the "Photo unavailable" box named for the apartment. Photos after the cover load lazily, and all use the no-referrer policy.

## ADR compliance

| ADR | Constraint | Where |
|---|---|---|
| 0078 | Keyboard and screen-reader use, 44px targets, reflow at 320px, reduced motion, text alternatives; critical facts before non-essential media | gallery markup and styles; the viewer's buttons and keys |
| 0080 | Works without JavaScript | server markup shows every photo as a link; the script only enhances |
| 0072 | Client code limited to reversible presentation effects | the viewer and strip are presentation only |
| 0073, 0081 | Weaver's Basic Catalog is unchanged; the client arranges its `Image` output | `organizeUnitDetail` |
| 0075 | Photos load with `referrerpolicy="no-referrer"`, and URLs carry no secrets | gallery images and viewer images |

## Answer

Delivered on `ui/listing-gallery`. The tests are in `test/listing-gallery.test.ts` (server markup, the full page, the served script) and `test/listing-gallery-chromium.test.ts` (real Chromium, one test per AC).

- **One gallery module**, `apps/local-guest/src/listing-gallery.ts`:
  - `listingGalleryHtml` is the server markup: every photo in order, linking to its full image.
  - `LISTING_GALLERY_STYLE` holds the shared styles.
  - `buildListingGallery` builds the same structure around the images Weaver renders in the chat.
  - `enhanceListingGallery` adds the strip count, "+K more", "Show all" and the viewer.
  - `watchPhotoFailure` provides the "Photo unavailable" box. It moved from `client.ts`, so the full page has it too.
- **Layout.** The gallery switches on its own width (a container query at 30rem), so the chat's side panel on desktop also gets the mosaic:
  - narrow: a `scroll-snap` strip, one photo at a time, with a "Photo X of N" count that follows the swipe (IntersectionObserver; `scrollsnapchange` is Chromium-only);
  - wide: the cover beside a 2×2 grid, with "+K more" and "Show all N photos".
- **The viewer** is a `<dialog>` opened with `showModal()` and built on first open. It is a full-screen swipe track with previous and next buttons, arrow, Home and End keys, and an "X of N" count. Esc, the close button or a tap on the dark area closes it (`closedby="any"`, plus a click fallback for Safari), and focus returns to the opener.
  - The count follows the track's position on every scroll event, not intersection reports, so the final photo is the one the track reached. The IntersectionObserver is no longer used in the viewer.
  - Next, Previous and the arrow keys step from the photo asked for while a programmatic scroll is still in flight (`pendingIndex`), so two quick presses move two photos. A swipe or wheel gesture clears the pending photo. A press that would not move the track returns at once.
  - The first and last photo use `aria-disabled` rather than `disabled`, so keyboard focus stays on the button; a press there does nothing. The visual state is the same `opacity` rule.
  - The visible count is not a live region. A visually hidden live region (`ui-sr-only`, `aria-live="polite"`) is written once the scroll settles, so screen readers hear the final photo, not each photo a scroll passes.
  - Design of the change: commits 6bb8767 (count follows the track; pending steps) and 6f56132 (`aria-disabled` endpoints and the settled live region).
- **Loading (the LCP guidance).** The cover loads eager with `fetchpriority="high"`; the rest lazily. Every image uses `referrerpolicy="no-referrer"`. Reduced motion turns off smooth scrolling.
- **The full page** loads `/gallery.js`, a second esbuild entry built from `gallery-page.ts` and committed with `client.js`. The CSP blocks inline scripts. Without JavaScript nothing is hidden.
- **Fixed while walking through:** with session-scoped Guests (the pilot and production), an expired or unknown session cookie made `/shortlet-foundations.css` return 401, so the public apartment page rendered unstyled. `PUBLIC_GUEST_PATHS` now exempts the page's static assets; this has its own test.
- **Test runner:** `scripts/run-tests.mjs` also treats a test as a browser test when it imports a helper that calls `launchRealBrowser`. Moving the browser setup into `listing-photo-browser.ts` had silently put two real-Chrome files back into the concurrent phase.
- **Checks:** `npm run check` is clean. The full `npm test` passed with 0 failures (1,135 tests in phase 1, and 128 in phase 2 across 18 files).
- **Test fixtures:** `test/helpers/listing-photo-browser.ts` is shared with `listing-photos-mobile-chromium.test.ts`. `image-fixtures.ts` serves `/photo-N.png`.
- **Walkthrough** (`.scratch/guest-gallery/walkthrough-gallery.ts`, launch configuration `gallery-walkthrough`):
  - 1280px full page: the mosaic, "+2 more" and "Show all 7 photos". The viewer opened at "3 of 7" with the photo fitted to the screen, after a fix: the photo had overflowed until each slide became a flexbox.
  - 390px: the strip with "Photo 2 of 7" after a swipe, and no sideways scroll.
  - Desktop chat panel (508px): the mosaic, after lowering the switch point from 36rem to 30rem.

## Comments
