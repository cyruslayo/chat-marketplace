# Phase 2b-05: Port chat message, persona, chips, composer and multi-domain controls

Status: ready-for-agent
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
