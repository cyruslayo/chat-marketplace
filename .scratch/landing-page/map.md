# Map: public landing page

PRD: `PRD.md`. Branch: `feat/landing-page` (cut from `wip/main-snapshot-2026-10-10`).

| # | Issue | Type | Blocked by |
| --- | --- | --- | --- |
| 01 | Static landing page at /welcome (HTML, CSS, photos, no-JS complete) | task | none |
| 02 | Landing motion script (hero typing, beat sequences, desktop pinning) | task | 01 |
| 03 | Captures, reflow/target checks and full verification | task | 02 |
| 04 | Light/dark switch and landing typography scale | task | 03 |
| 05 | Landing copy from the panel deck, FAQ fix, "Nothing due yet" tags | task | 04 |
| 06 | Owner approvals for the "A + C · Lagos, in conversation" direction | grilling (ready-for-human) | none |
| 07 | Brand layer foundations: logomark, self-hosted fonts, landing tokens | task | 05, 06 |
| 08 | Rebuild the landing page as "A + C · Lagos, in conversation" | task | 07, 06 |
| 09 | Motion for the new layout: hero chat window and one pinned phone | task | 08 |
| 10 | Captures, budgets and full verification for the new landing page | task | 09 |

Issues 06–10 follow the redesign chosen on 13 Oct 2026 (design audit `design-audit.md`; canvas <https://claude.ai/artifact/5ENjonAtFM3UMzBnvzGLrL>, boards `Mix-Desktop` and `Mix-Phone`; spec `docs/design/shortlet-landing-page-direction.md`). 07–10 are one wave, verified together in 10.

## Context pointers

(Append one line per resolved issue: what landed and where.)
- 01–05 (resolved 14 Oct 2026, commit 44fcec4): the first landing wave. Static page at /welcome, the motion script, captures, the theme switch and type scale, and the copy deck in `apps/local-guest/src/landing-copy.ts`. Restructured by 08 and 09.
- 06 (open, ready-for-human): approvals for the mixed direction. Approved: logo, fonts, copy, tags, chips, footer labels. Still open: photography (item 5).
- 07 (resolved, 44fcec4): brand layer. Logomark `landing-brand.ts`; fonts in `apps/local-guest/assets/fonts/` served at `/landing/fonts/`; the colour token block at the top of `apps/web/src/shortlet-landing.css`; helper `test/helpers/landing-tokens.ts`.
- 08 (resolved, 44fcec4): the ten-section page in `landing-page-html.ts`, plus the `placeholders` / `helpLinks` options, `landing-units.ts` and `landing-photos.ts` (gated by `approved`).
- 09 (resolved, 44fcec4): motion in `landing-page.ts`. The hero plays once, the phone pins at 64rem+, the app bar overlays the hero, and inactive steps are dimmed by colour.
- 10 (resolved, 44fcec4): the gate. Evidence: `screenshots/10/`, full run 1ba3c8e4 and isolated reruns, with the owner exception to DoD item 9. The photo budget test is skipped (owner-deferred until 06 item 5).
