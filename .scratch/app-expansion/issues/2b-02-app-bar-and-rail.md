# Phase 2b-02: Port app bar and journey rail

Status: resolved
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

| ADR | Constraint imposed | Affected acceptance criterion / code path |
| --- | --- | --- |
| 0005 | Booking Request never presented past Request until Operator accepts; failed step never shown as progress | AC3 / `railHtml` (`guest-kit.ts`), `renderJourney` (`client.ts`) |
| 0077 | Semantic palette and dark/system modes via shared stylesheet; copy stays in `guest-content.ts` | AC3, I2, I4 / `shortlet-foundations.css`, `guest-kit.ts`, `client.ts` |
| 0078 | Mobile-first baseline: >=44px targets, 320px/320x568 overflow-free app bar, responsive compact mobile rail | AC1–AC4 / `.ui-appbar*`, `.ui-rail-nav*`, `.ui-page--short`, captures |
| 0080 | Chat and standalone pages share one helper/contract | AC3, I6 / `railHtml`, `renderJourney` (`Step N of 6 · <label>` + 6-step `.ui-rail`) |
| 0106 | Cold-restore integrity on assistant/sync threads | I7 / `test/assistant-cold-journey.test.ts` |
| 0107 | Mode accent isolation (`--mode-*` separate from buttons/money/status; static human agent mark without animation) | I2 / `.ui-mode-label*`, `.ui-agent-mark*`, `test/agent-mode-shell.test.ts`, `test/agent-mark-shell.test.ts` |
| 0108 | Pinned round-12 design bundle authority; unshipped routes (`/help`, `/plans`) and unapproved tokens/copy held back | AC1, I1, I4, I9 / `shortlet-foundations.css`, `guest-kit.ts` |

## Tests

`npm run check`, `test/guest-retired-classes.test.ts`, `test/assistant-cold-journey.test.ts` (if shell/sync touched), rail/mode-choice tests, and `capture-11-all.sh`. Record exact commands, counts, and capture findings in `## Comments`.

## Comments

- Ported `2b-02` app bar, journey rail, mode label, still `.ui-agent-mark`, `.ui-badge`, `.ui-app*`, `.ui-sidenav*`, `.ui-dialog*`, and `.ui-page--short` / short-phone rules (`@media (max-height: 37.49rem)`) in [shortlet-foundations.css](../../../apps/web/src/shortlet-foundations.css), using `container-type: inline-size` on `.ui-appbar` and `.ui-rail-nav` so standalone `pageShell` headers and in-container components respond identically.
- Updated `railHtml` in [guest-kit.ts](../../../apps/local-guest/src/guest-kit.ts) and `renderJourney` in [client.ts](../../../apps/local-guest/src/client.ts) to render both the `<40rem` compact bar (`.ui-rail-nav__compact`: `Step N of 6 · <label>` + `.ui-rail-nav__bar`) and the `>=40rem` 6-step `.ui-rail` from the same `GuestJourney` projection, preserving `data-state`, `aria-current="step"`, and `firstChild.textContent === step.label`.
- **Held back for owner (issue 07 / `copy-decisions.md` / Phase 3 shell):**
  - Token not added: `--color-scrim` (`.ui-dialog::backdrop` uses `var(--color-surface-inverse)` + `opacity: 0.6`).
  - Copy & routes held back: `appBarHtml` and `renderGuestShellHtml` remain unchanged (`"Shortlet"` kept, no `"Xenia"`, no `"Close {task}"`, no `"Help"` / `/help` / `/plans` / Tab bar / Ask bar added before Phase 3 issues 11/15/16).
- **Verification:**
  - TDD Red run: `npx tsx --test test/round12-class-parity.test.ts test/round12-2b-02.test.ts` -> `2 pass, 4 fail` (AC1/AC2, AC3, I2/I4, I3 failed prior to implementation).
  - `npm run build && npm run check && npx tsx --test test/round12-class-parity.test.ts test/guest-journey-rail.test.ts test/guest-kit.test.ts test/guest-kit-targets.test.ts test/guest-retired-classes.test.ts test/agent-mode-shell.test.ts test/agent-mode-follows-task.test.ts test/agent-mark-shell.test.ts test/assistant-cold-journey.test.ts test/shortlet-token-parity.test.ts` -> **61 pass, 0 fail**.
  - Sequential browser tests after fixing `document.readyState === 'complete'` & search-step container measurement in `test/round12-2b-02.test.ts`: `npm run check && npx tsx --test test/round12-2b-02.test.ts && npx tsx --test test/guest-journey-rail-chromium.test.ts` -> **3 pass, 0 fail** + **1 pass, 0 fail**.
  - Sequential 21-group `capture-11.ts` sweep (`320`, `390`, `768`, `1280`, light & dark) saved into `.scratch/guest-ui-consistency/screenshots/2b-02/`: **0 horizontal overflow**, **0 actionable controls under 44px** across all 21 groups (only expected 1x1 hidden radio `<input>`s on `payment-choice`).
  - Post-commit `npx tsx --test test/landing-page.test.ts` (see git log / final report).
