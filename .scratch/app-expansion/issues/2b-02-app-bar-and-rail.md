# Phase 2b-02: Port app bar and journey rail

Status: ready-for-agent
Type: task
Blocked by: 07, 2b-01

## Why

Apply the round-12 App bar 320px/short-phone rules, mode label, Task bar CSS, and compact mobile Journey rail from `Main.dc.html` and [bundle.css](../design/round-12/bundle.css) without changing navigation structure or adding unshipped shell routes (Tab bar / Ask bar / `/plans` belong to Phase 3 issue 15).

## What to build

- Port `.ui-appbar*` (including `@container (max-width:23rem)` hiding wordmark after Back, `.ui-appbar__label` at `40rem`, `.ui-appbar--task`, `.ui-appbar--root`), `.ui-mode-label*` (`.ui-mode-label--control`, `__prefix` hidden at `<=26rem`), `.ui-agent-mark*`, `.ui-badge`, `.ui-page--short` / `@media (max-height:37.49rem)` short-phone bar rules, and `.ui-rail-nav` / `.ui-rail` / `.ui-rail-nav__compact` / `.ui-rail-nav__bar`.
- Add CSS support for `.ui-sidenav*` and `.ui-dialog*` where needed for existing mode-chooser dialog styling, while keeping current guest navigation and routes intact until issues 11/15/16.
- Update `appBarHtml` (`apps/web/src/ui-kit.ts`) and `railHtml` (`apps/local-guest/src/guest-kit.ts`) only as needed to emit the pinned `ui-appbar` / `ui-rail-nav` structure without changing copy or routes.
- Serial files: `apps/web/src/shortlet-foundations.css`, `apps/local-guest/src/guest-kit.ts`, `apps/local-guest/src/guest-server.ts`, `apps/local-guest/src/client.ts`.

## Acceptance criteria

- AC1: At 320px width, Back + mode label + action/Help fit on one row with zero wrapping and every control >=44px (`Main.dc.html` rule).
- AC2: At 320x568 short-phone height, bar heights trim cleanly while keeping all controls >=44px.
- AC3: Journey rail renders compact `"Step N of 6 · <step>"` below `40rem` and the full 6-step `.ui-rail` at `40rem+`, using `GUEST_JOURNEY` copy from `guest-content.ts`.
- AC4: Captures at 320/390/768/1280 light and dark under `screenshots/2b-02/` and `capture-11-all.sh` pass with zero overflow and zero targets <44px.

## Integrity checks (`kickoff.md` §4)

- **I1 (Fact map):** Journey steps and mode label trace to `projectJourney` (`journey-rail.ts`) and `GUEST_MODES` (`guest-content.ts`). No unbuilt `/help` or `/plans` links added before issues 11/15/16.
- **I2 (Token parity):** Semantic tokens only; zero hex outside the token block.
- **I3 (Class parity):** Matches `class-map.md`; keeps existing code hooks (`ui-task-rail*`, `agent-mark*`, etc.) unless replaced; zero `xk-*`/`bd-*` in `apps/`.
- **I4 (Copy provenance):** Existing `GUEST_JOURNEY` and `GUEST_MODE_CHOOSER` strings only; no unapproved `New`/`Brand` copy (`Close {task}`, `Help` link text, etc. wait on approval).
- **I6 (Chat and page agree):** `railHtml` and `appBarHtml` remain the single markup helpers across chat and standalone pages.
- **I7 (Cold restore):** If shell or assistant sync is touched, verify with assistant enabled and a cold restore before every event (`ADR 0106`, 2026-10-27 clock, unseeded guest).
- **I8 (Captures):** 320/390/768/1280 light & dark + `capture-11-all.sh` pass (including 320x568 check).
- **I9 (Navigation):** Preserve every existing Back/exit link; no dead ends.
- **I10 (Scope):** Stays only; commerce stays off.

## ADR compliance

0005, 0077, 0078, 0080, 0106, 0107, 0108.

## Tests

`npm run check`, `test/guest-retired-classes.test.ts`, `test/assistant-cold-journey.test.ts` (if shell/sync touched), rail/mode-choice tests, and `capture-11-all.sh`. Record exact commands, counts, and capture findings in `## Comments`.

## Comments
