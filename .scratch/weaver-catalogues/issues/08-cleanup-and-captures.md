# Clean-up, retirement guard and capture sweep

Status: resolved
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
  - Current setup/build guidance must not direct contributors to the retired vendored packages or verifier. Keep dated issue comments and validation records as historical evidence; clarify their historical context rather than rewriting what was true when recorded.
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

## Answer

Resolved 19 Nov 2026 on branch `claude/wonderful-thompson-iicglk` (`61726b2`, `b6cd3b9`, `c57e363`). Orchestrated: Haiku 5.5 agents (medium effort, one writer at a time) wrote the guard, the doc edits and the gate test fixes; the orchestrator verified each diff and ran the sweep and the gate.

- **Dead helpers.** `findFact`, `replaceWithKitMarkup`, `dayNumeral`, `isMoney`, `isPriceLabel` were already deleted with issues 05–07 and 04. `guestFactValue` is removed (no callers; its four self-tests went with it). `guestFact` stays: nine builders outside this effort (cancellation, check-in support and others) still emit label-prefixed facts. `GUEST_FACT_LABELS` stays.
- **AC1 guard.** `test/guest-retired-classes.test.ts` "Weaver catalogues 08 AC1" fails if `client.ts` names any of `organizeUnitDetail`, `organizeBookingTicket`, `decorateDiscoveryCards`, `decorateComparison`, `findFact`, `viewUnitIds`, `replaceWithKitMarkup`, `UNIT_TILE_FACTS` or `guestFactValue`, with "render a typed shortlet-* component instead (ADR 0102)". Proved by reintroducing `findFact` (the test failed) and restoring it.
- **AC2.** Outside `.scratch/` and ADR 0102's evidence, the only hits for the retired names are the guard tests themselves, and `@weaver/` appears only as the deliberately built forbidden string in `weaver-dependency-boundary.test.ts`. No current doc or script points to the vendored packages or verifier. The issue text cites "ADR 0096"; the accepted catalogue ADR is 0102, which the docs cite.
- **Docs.** `guest-kit.ts` header (renderers call the helpers from schema-validated props), `docs/design/shortlet-design-system-direction.md` "Typed chat components (ADR 0102)" table (catalogue, component, kit helper, builder; every name grep-verified) and the AGENTS.md Guest UI bullet (add a typed `shortlet-*` component; never rebuild Weaver's DOM by label or position).
- **AC3.** `capture-11-all.sh`, one group per process, light and dark, all 21 groups at 320, 390, 768 and 1280: no horizontal overflow. The only findings are payment-choice's three hidden native radio inputs (1×1), whose labels are the 44px targets (AGENTS.md; recorded the same way in issue 03). Captures and `findings-*.txt` committed in `screenshots/final/`.
- **AC4, the batch gate** (on `b6cd3b9`, then the non-browser phase again on `c57e363`): clean `npm ci` passed; `npm run check` clean; `npm run build` passed; `npm run test:workers` 30 files, 197 tests passed; full `npm test`: phase 2 48 of 51 files passed (the AGENTS.md accepted commerce files and `paystack-real-browser`, which needs network the container does not have and fails identically at `f241ada`). Phase 1 found three tests outside issue 04's set still reading the retired booking Texts (`guest-draft-revision` AC3, `guest-must-fix-ux` title test, `notice-to-end-chat` Give-notice title); they were retargeted to the StayTicket title and PriceBreakdown total (`c57e363`, 31 passed). Phase 1 rerun: 3537 passed, 2 failed: the Windows junction case in `assistant-recording-clients` (environment; fails at `f241ada`) and `model-quota-guard` AC3 (quota timing under concurrent load; passes solo 3 of 3 here and 2 of 2 at `f241ada`).
- **AC5.** Every issue (01–08) has its answer or resolution record, and `map.md` has a context pointer per issue; the PRD and map mark the effort complete.
