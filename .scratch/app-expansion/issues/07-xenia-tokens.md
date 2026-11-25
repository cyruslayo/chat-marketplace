# Xenia tokens in the code's own token names

Status: ready-for-agent
Type: task
Blocked by: none. Serial with any other change to `shortlet-foundations.css`

## Why

The kit and the code disagree on colour. The owner confirmed Adire Indigo on 20 Nov 2026, and the brand's open decision 1 asks for this issue.

## What to build

- Keep the code's semantic names and change their values, light and dark. Use kit audit §5 (`docs/design/xenia-ui-kit-parity-audit.md` on `docs/ux-guidelines` until issue 01 lands) and the design system's `tokens.json` (<https://claude.ai/artifact/XH7yVkfLzKG357Gxqc1F3d>).
- Mode tokens: keep `main`'s `--mode-accent`, `--mode-accent-subtle`, `--mode-on-accent` and `--mode-tint`. Stays takes clay. The kit's `--mode-subtle` maps to `--mode-accent-subtle`. Today the stays block uses the action colour; after this it must not.
- Derive the `--color-*-border` and `--color-info*` values the brand does not define, and record how.
- Update the theme colour that follows the mode tint (agent-modes 03k), and the landing tokens.
- Keep the committed CSS formatting. Change no component rule.

## Acceptance criteria

- AC1: Every mapped token has the brand value in both themes. A test reads one mapping, not copies of the hex.
- AC2: Text and control contrast meets WCAG 2.2 AA for every pair the foundation tests cover, in both themes.
- AC3: The action colour is never a mode accent, and a mode accent is never used for an action, money or status.
- AC4: `capture-11-all.sh` passes: no overflow, no control under 44px. Captures are saved under `screenshots/07/`.
- AC5: No class, markup or copy changes; the diff is tokens, tests and captures.

## ADR compliance

0078, 0107 decision 4. AGENTS.md: semantic tokens only.

## Tests

The files that read `shortlet-foundations.css` (25 at d1d5955), then `npm run check`.

## Comments
