# Clean-up, retirement guard and capture sweep

Status: ready-for-agent
Type: task
Blocked by: 04, 05, 06, 07
Requested: 6 Oct 2026

## Why

Once 04–07 land, the label-matching helpers are dead code. The docs also still describe the old flow:
- AGENTS.md says "Basic Catalog unchanged" for guest UI work
- the `guest-kit.ts` header says the chat organizers rebuild Weaver output
- the design-system direction doc lists the kit without the renderers

Shared CSS and shell structure may also have shifted, so the full sweep must re-run.

## What to build

- **Dead helpers.** Remove `findFact`, `replaceWithKitMarkup`, `dayNumeral`, `isMoney` and `isPriceLabel` from `apps/local-guest/src/client.ts` if nothing uses them.
- **Label-prefix exports.** Remove `guestFact` and `guestFactValue` from `apps/web-agent/src/guest-content.ts` only if no builder or page still emits label-prefixed facts. `GUEST_FACT_LABELS` stays: the kit uses it for visible labels.
- **Retirement guard.** Extend `test/guest-retired-classes.test.ts` so that `client.ts` defines none of `organizeUnitDetail`, `organizeBookingTicket`, `decorateDiscoveryCards`, `decorateComparison`, `findFact` or `viewUnitIds`.
- **Docs.**
  - the `guest-kit.ts` header comment: the renderers in `shortlet-renderers.ts` call these helpers
  - the "Guest UI kit" section of `docs/design/shortlet-design-system-direction.md`: list the catalogue components and their kit helpers
  - the AGENTS.md "Guest UI work" bullet: use the kit, and add a typed `shortlet-*` component through ADR 0096 rather than DOM patching
  - `vendor/weaver` mentions anywhere left over from 01
- **Capture sweep.** Run the full `capture-11-all.sh` sweep, light and dark, one screen group per process, into `.scratch/guest-ui-consistency/screenshots/final/`, and review the `findings-*.txt`. Delete `walkthrough-06.log` afterwards.

## Acceptance criteria

- **AC1:** `test/guest-retired-classes.test.ts` fails if any retired organizer or the label matcher is reintroduced in `client.ts`.
- **AC2:** The repo has no source hit for `@weaver/`, `findFact(`, `organizeUnitDetail`, `organizeBookingTicket`, `decorateDiscoveryCards` or `decorateComparison`, outside `.scratch/` history and ADR 0096's evidence section.
- **AC3:** The full capture sweep reports zero horizontal overflow and zero controls under 44px, in light and dark.
- **AC4:** `npm run check` is clean, `npm test` passes in full, and a clean `npm ci` works.
- **AC5:** Each issue's `## Answer` and a context pointer line in `map.md` are written. The PRD and map show the effort complete.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0078 | 44px targets, 320px reflow, both themes. | AC3 |
| 0081 / 0096 | Custom components go through the catalogue, not DOM patching. | AC1, AC2; AGENTS.md note |

## Comments
