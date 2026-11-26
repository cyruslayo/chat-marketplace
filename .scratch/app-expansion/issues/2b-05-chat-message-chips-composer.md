# Phase 2b-05: Port chat message, persona, chips, composer and multi-domain controls

Status: resolved
Type: task
Blocked by: 07, 02, 2b-01

## Why

Port the conversation primitives — chat message & persona (including the 24px / 12px human persona mark fix), criteria chips, composer, concierge chooser, domain tag, and switch divider — to the pinned round-12 [bundle.css](../design/round-12/bundle.css) in the component library format settled by issue 02.

## What to build

- Port `.ui-conversation`, `.ui-persona*` (including `.ui-persona--human .ui-persona__mark` 24×24 with `12px` font — kit defect #2), `.ui-message*` (`.ui-message--guest`), `.ui-chips`, `.ui-chip*` (`--add`, `--demo`), `.ui-composer*` (`__input`, `__send`), `.ui-chooser*` (strip and `--dialog`), `.ui-domain-tag`, and `.ui-switch-divider*` using [class-map.md](../design/round-12/class-map.md) and the library format decided in issue 02 (`apps/web-agent/src/shortlet-catalogs.ts`, `apps/local-guest/src/shortlet-renderers.ts`, `apps/local-guest/src/guest-kit.ts`).
- Keep existing client/assistant event contracts, `GUEST_MODES`, `GUEST_MODE_CHOOSER`, and `guestModeSwitchAnnouncement` (`ADR 0107`).
- Serial files: `apps/web/src/shortlet-foundations.css`, `apps/local-guest/src/guest-kit.ts`, `apps/local-guest/src/client.ts`, `apps/local-guest/src/shortlet-app.ts`.

## Acceptance criteria

- AC1: `.ui-persona--human .ui-persona__mark` renders at 24×24 with >=12px font size (kit defect #2 fixed).
- AC2: Criteria chips, composer input/send button, and chooser options all meet >=44px targets and focus-visible rules at 320–1280 in light and dark themes.
- AC3: Component exports match the library format settled by issue 02 and preserve all `ADR 0102` / `ADR 0107` schema validations.
- AC4: Assistant-enabled cold-restore journey (`ADR 0106`, 2026-10-27 clock, unseeded guest) passes without regressions.
- AC5: Captures at 320/390/768/1280 light and dark under `screenshots/2b-05/` and `capture-11-all.sh` pass with zero overflow and zero targets <44px.

## Integrity checks (`kickoff.md` §4)

- **I1 (Fact map):** Criteria chips, mode chooser, and switch divider trace to `GuestCriteria`, `GUEST_MODES`, and `mode-announcement.ts` in `fact-map.md`.
- **I2 (Token parity):** Semantic tokens only (mode tokens reach components only via `[data-mode]` -> `--mode-accent`/`--mode-subtle`); zero hex outside the token block.
- **I3 (Class parity):** Matches `class-map.md`; zero `xk-*`/`bd-*` classes in `apps/`.
- **I4 (Copy provenance):** Only `guest-content.ts` strings; no unapproved `New`/`Brand` strings (`Ask the concierge`, `Stay here` Language draft, etc. require approval).
- **I6 (Chat and page agree):** Chat transcript and `/conversation` no-JS fallback render from the same presentation and kit helpers.
- **I7 (Cold restore):** Must test with assistant runtime enabled and a cold restore before every event on a fresh thread (`test/assistant-cold-journey.test.ts`).
- **I8 (Captures):** 320/390/768/1280 light & dark + `capture-11-all.sh` pass.
- **I10 (Scope):** Stays only; Events/Services/Community rows on `Domains.dc.html` remain structural/test-only per D2/D12.

## ADR compliance

0075, 0077, 0078, 0102, 0106, 0107, 0108.

## Tests

`npm run check`, `test/assistant-cold-journey.test.ts`, `test/guest-retired-classes.test.ts`, mode-chooser/switch tests, and `capture-11-all.sh`. Record exact commands, counts, and capture findings in `## Comments`.

## Comments

- 26 Nov 2026 (issue 02 reconciliation, see [notes/02-surface-kit.md](../notes/02-surface-kit.md)):
  - All 6 `2b-05` component families (`ChatMessage`/`Persona`, `CriteriaChip`, `Composer`, `ConciergeChooser`, `DomainTag`, `SwitchDivider`) are **shell/platform chrome** (`ADR 0106`, `ADR 0107`), **not** A2UI Surface Components.
  - **What `2b-05` must do differently:**
    1. Do **not** edit `apps/web-agent/src/shortlet-catalogs.ts`, `apps/local-guest/src/shortlet-renderers.ts`, or `packages/surface-kit`, and add **no** new catalogue IDs (`ADR 0073`) or A2UI schemas.
    2. Satisfy AC3 by exporting/keeping these as shared kit & shell helpers (`apps/local-guest/src/guest-kit.ts`, `client.ts`, `guest-server.ts`, `apps/web/src/shortlet-foundations.css`) while keeping all existing `ADR 0102` / `ADR 0107` validations green (`test/shortlet-catalog-validation.test.ts`, `test/assistant-cold-journey.test.ts`).
    3. Coordinate `.ui-chip--demo` (`demoListingChipHtml()` in `guest-kit.ts`) with `2b-04`, since `StayCard` (`StayCard`) and `UnitDetailSheet` render it inside A2UI discovery surfaces.
    4. `2b-05` does **not** need to wait for Follow-ups A–C (surface-kit code landing) because it makes zero A2UI catalogue changes; only `07` and `2b-01` block it.

- 26 Nov 2026 (resolved). Worktree `C:\AI2026\chat-marketplace-ae-chat`, branch `feat/app-expansion-2b-05` (from `feat/app-expansion` at `60b321d`). All commands run with `NODE_ENV=test` and `LLM_API_KEY` unset.

  **ADR table**

  | ADR | Constraint | Where it holds |
  | --- | --- | --- |
  | 0073 | Closed catalogues; no new ID; no CSS injection | Zero catalogue changes: no 2b-05 class or `ChatCard` appears in `shortlet-catalogs.ts` (asserted in `test/round12-2b-05.test.ts`); `test/shortlet-catalog-validation.test.ts` green |
  | 0075 | Escaped props, no executable markup | `personaRowHtml` / `switchDividerHtml` / `domainTagHtml` escape every caller value; hostile-props test in `round12-2b-05.test.ts` |
  | 0077 | No hardcoded copy in shared components | All copy from `guest-content.ts` (`GUEST_MODE_CHOOSER.conciergeLabel`, `guestModeSwitchAnnouncement`, mode presentations) |
  | 0078 | 44px targets, 320px reflow, focus-visible | Real-Chrome AC2 test at 320 and 1280, light and dark; `capture-2b05*.ts` groups assert no overflow and no target under 44px |
  | 0102 | Typed catalogues unchanged | `shortlet-catalogs.ts` untouched; `test/shortlet-catalog-validation.test.ts` green |
  | 0106 | Chip edits are structured guest input; cold restore re-keys ids; no new persisted state | Criteria-chip edit path untouched; `test/assistant-cold-journey.test.ts` green (2026-10-27 clock, unseeded guest, cold restore before every event); the switch divider is a render-only DOM row — nothing is persisted or re-minted |
  | 0107 | Server owns the mode; `--mode-*` tokens only; a switch leaves divider rows with no copied text | Chooser previews only; commits go through `platform.task.start`/`switch`; divider rendered from the held switch copy inside `role="log"` (decision 11); persona wording only with 2+ modes (10 Nov owner note — the helper is not wired into single-mode turns) |
  | 0108 | Tiers; manifest composition; snapshot gate | All 6 families stay shell/platform chrome (issue 02 note); no tier, manifest or snapshot work |

  **What landed**

  - `apps/web/src/shortlet-foundations.css`: `.ui-conversation`, `.ui-persona*` (human mark 24px with 700 12px initials — kit defect #2), `.ui-message*`, `.ui-chips`, pinned `.ui-chip`/`--add`/`--demo` (44px pill, inset ring, selected chip takes `--mode-accent` ring + `--mode-accent-subtle` fill), `.ui-composer*` (44px round send, `:focus-within` ring), `.ui-chooser*` (strip + `--dialog` rows), `.ui-domain-tag`, `.ui-switch-divider*`.
  - `apps/local-guest/src/guest-kit.ts`: `personaRowHtml` (JSON-serialisable props, escaped, human variant), `switchDividerHtml`, `domainTagHtml`; `composerHtml` chat and page variants emit `ui-composer`/`__input`/`__send` (page send button gains `id="composer-submit"` so both variants share the contract); `emptyStateHtml` starters bar gains `ui-chips`.
  - `apps/local-guest/src/client.ts`: turns gain `ui-message` (guest bubbles `ui-message--guest`) beside the `turn`/`bubble` hooks; chooser options become `ui-chooser__option` with `__text`/`__line` (radio pattern and `mode-choice` hook kept); strip is `mode-choices ui-chooser` with a `ui-chooser__options` grid; sheet is `mode-sheet ui-dialog ui-chooser--dialog`; quick replies gain `ui-chips`; a committed switch now also renders one `ui-switch-divider` row in the lane (from `mode-announcement.applyResponse`, which returns the held copy).
  - `apps/local-guest/src/mode-announcement.ts`: `applyResponse` returns the held switch copy (DOM-free; the client renders the divider from it).
  - `test/round12-2b-05.test.ts` (new, 7 tests) and the 2b-05 group in `test/round12-class-parity.test.ts`; `test/fixtures/guest-shell-pre-agent-modes.html` re-snapshotted for the composer/`ui-chips` markup (AC4 of `agent-mode-shell`).
  - `apps/local-guest/dist/client.js` regenerated with `npm run build`.

  **Commands and counts** (all green unless noted)

  - `npm run check` — clean.
  - `npx tsx --test test/round12-2b-05.test.ts test/round12-class-parity.test.ts` — 10 pass, 0 fail (after the TDD red run: 0 pass, 1 fail on the missing `domainTagHtml` export, and class parity 2 pass, 1 fail on the missing 2b-05 classes).
  - `npx tsx --test test/round12-2b-05.test.ts test/round12-class-parity.test.ts test/guest-retired-classes.test.ts test/self-hosted-type.test.ts test/shortlet-catalog-validation.test.ts test/agent-mode-announcement.test.ts test/agent-mode-preview.test.ts test/agent-mode-shell.test.ts test/agent-mode-follows-task.test.ts test/mode-suggestion-tier-c.test.ts test/guest-kit.test.ts test/shortlet-design-system.test.ts test/local-guest-shell.test.ts` — 101 pass, 0 fail. (`agent-mode-shell` AC4 failed once on the stale shell snapshot before the fixture re-snapshot; 9/9 after.)
  - `npx tsx --test test/assistant-cold-journey.test.ts test/pilot-commerce-off.test.ts` — 9 pass, 0 fail (AC4 cold-restore journey, 2026-10-27 clock, unseeded guest; commerce-off shells still render no starters/task rail).
  - Real Chrome, one file at a time: `test/guest-composer-sizing-chromium.test.ts` 2/2; `test/agent-mode-sheet-chromium.test.ts` 5/5; `test/guest-criteria-strip-chromium.test.ts` 2/2; `test/assistant-clarification-chips-chromium.test.ts` 2/2; `test/guest-app-frame-chromium.test.ts` 2/2; `test/agent-mode-theme-color-chromium.test.ts` 2/2; `test/shortlet-ui-foundations.test.ts` 2/2.

  **Captures** (`screenshots/2b-05/`, not staged)

  - `capture-2b05.ts` (chat `/?threadId=` and no-JS page `/conversation?threadId=` at a review-stage thread): 16 shots, light and dark at 320/390/768/1280 — zero horizontal overflow, no target under 44px.
  - `capture-2b05b.ts` (two-mode fixture: `chooser-strip` and opened `chooser-sheet`): 16 shots, light and dark at 4 widths — zero overflow, targets pass (`mode-choice`, `mode-mark`, `mode-sheet__close`, `#composer-submit`, starters ≥44px).
  - `capture-11-all.sh` full sweep re-run after the shared `.ui-chip` CSS change: 20 groups × 8 frames into `screenshots/final/`, no overflow or small-target findings (run log `capture-11-2b05-run.txt`).

  **Held back (no owner approval — kickoff I4 / copy-decisions.md)**

  - "Current" tag and "Change concierge" primary inside the chooser dialog (New, TaskRail/CopyReview) — the sheet keeps its checked radio and Close.
  - "Ask the concierge" Ask bar / `.ui-composer--link` (Brand) — Ask bar stays Phase 3 (`15`).
  - Starters copy stays `"Explore Abuja"` / `"Explore Lagos"` (Brand replacement "Find a stay in …" not approved).
  - No human persona name ("Tolu from the Xenia team", D14); `personaRowHtml` takes caller-supplied initials only.
  - The four issue-07 tokens stay unapproved; `--color-scrim` (dialog backdrop) not added; the chooser dialog backdrop keeps the current shell treatment.
  - `.ui-domain-tag` helper landed but the task-rail/step-header rows keep `ui-domain-chip`: DomainTag README forbids the tag while Stays is the only domain, so rewiring those rows waits for a real second domain (D2/D12).
  - The `@container (max-width: 26rem)` two-column strip rule is in the kit CSS (as pinned) but the chat shell strip has no `container-type` root yet (`guest-server.ts` untouched, per this issue's serial-files list), so the strip stays one row; it applies wherever a `.ui-page` hosts the strip.
  - The `.criteria-chips` container keeps its shell styles (same reason); the chips themselves are the pinned `.ui-chip`.
