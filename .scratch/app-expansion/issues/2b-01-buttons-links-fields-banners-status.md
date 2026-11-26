# Phase 2b-01: Port buttons, links, fields, banners and status

Status: ready-for-agent
Type: task
Blocked by: 07

## Why

Port the atomic controls and status primitives in `apps/web/src/shortlet-foundations.css` and `apps/local-guest/src/guest-kit.ts` to the pinned round-12 [bundle.css](../design/round-12/bundle.css) before higher-level layout and chat groups build on them.

## What to build

- Port `.ui-button*` (`.ui-button`, `--primary`, `--secondary`, `--quiet`, `--pill`, `--small`, `--block`, `[aria-busy]`, `[disabled]`), `.ui-link`, `.ui-field*` (including `.ui-choice`, `.ui-legend`), `.ui-banner*` (`.ui-banner--info`, `__title`, `__body`, `__actions`), `.ui-status*` (`.ui-status--muted` alongside existing status tones), `.ui-tag*`, `.ui-deadline*`, `.ui-facts*`, `.ui-empty*`, and `.ui-skeleton*` using [class-map.md](../design/round-12/class-map.md).
- Keep the committed formatting of `shortlet-foundations.css` (do not run a formatter; foundation regex tests depend on it).
- Keep existing code-only classes (`ui-button--destructive`, `ui-sr-only`, `ui-eyebrow`, `ui-upload`, `ui-status--neutral`, `ui-status--stale`, etc.) unless a board explicitly replaces them.
- Serial files: `apps/web/src/shortlet-foundations.css`, `apps/local-guest/src/guest-kit.ts`.

## Acceptance criteria

- AC1: Every mapped class in this group matches the pinned [bundle.css](../design/round-12/bundle.css) rules using semantic tokens only (no raw hex, no `xk-*`/`bd-*`).
- AC2: All interactive controls (`.ui-button`, `.ui-link`, `.ui-choice`, `.ui-field__input`) meet >=44px targets and focus-visible contrast in light and dark themes.
- AC3: No existing copy or behaviour changes; any `Code` string rendered in this group stays sourced from `guest-content.ts` (no unapproved `New`/`Brand` copy).
- AC4: Captures at 320/390/768/1280 light and dark under `screenshots/2b-01/` and `capture-11-all.sh` pass with zero horizontal overflow and zero targets <44px.

## Integrity checks (`kickoff.md` §4)

- **I1 (Fact map):** No new facts or actions added; existing deadline/status fields trace to `fact-map.md`.
- **I2 (Token parity):** Uses only semantic tokens mapped in issue 07; zero hex outside the token block.
- **I3 (Class parity):** Every class matches `class-map.md`; retired classes (`.waiting-panel`, `.stay-result`, `GUEST_STAY_PAYMENT_STYLE`) remain absent; zero `xk-*`/`bd-*` classes in `apps/`.
- **I4 (Copy provenance):** No `New` or `Brand` strings from `copy-decisions.md` introduced without owner approval.
- **I6 (Chat and page agree):** Shared helpers in `guest-kit.ts` continue to render identical status, deadline, and banner markup for chat and pages.
- **I8 (Captures):** 320/390/768/1280 light & dark captures + `capture-11-all.sh` pass.
- **I10 (Scope):** Stays only; commerce stays off.

## ADR compliance

0075, 0077, 0078, 0080, 0107, 0108.

## Tests

`npm run check`, `test/guest-retired-classes.test.ts`, foundation CSS/token tests, and `capture-11-all.sh` (one group at a time). Record exact commands, counts, and capture findings in `## Comments`.

## Comments
