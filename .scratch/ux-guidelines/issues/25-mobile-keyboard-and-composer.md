# 25 · Mobile keyboard and composer sizing

Status: resolved
Type: task
Blocked by: none
Phase: 3 (Batch C)
Applicable ADRs: 0078; guideline §7 (16px inputs), §12

## What to build

- Add `interactive-widget=resizes-content` to the shell's viewport meta, so the layout resizes when the Android keyboard opens (ignored elsewhere).
- Use `field-sizing: content` on the composer textarea, with `max-block-size` and the existing sizing as the fallback (progressive enhancement).
- Check at 320 and 390 with a mobile viewport that the composer and Send stay visible while typing, and that the open workspace sheet is not covered.

## Acceptance criteria

1. The viewport meta includes interactive-widget=resizes-content on guest pages
2. The composer grows with content up to its limit, and browsers without field-sizing keep the current behaviour
3. Composer text is at least 16px

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0078 | 16px mobile inputs, 320px reflow, readable composer, keyboard operation. | AC1-AC3. |
| 0080 | The no-JS route keeps the same composer behaviour. | Both shells carry the same viewport meta. |

### Code contradiction recorded

The issue describes a composer **textarea**, but the implementation uses `<input id="composer-input" type="text">` in both the chat shell and the no-JS page. Converting it would change Enter-to-send and touch many real-browser tests; that is a larger interaction change than this issue authorises. The enhancement is applied to the existing input: `field-sizing: content` with `max-block-size: 8rem`, while `min-height: var(--control-min-field)` remains the fallback where `field-sizing` is unsupported. Vertical growth is therefore limited to what a single-line input supports; a textarea conversion is proposed as a follow-up, not forced here.

### Implementation

- `interactive-widget=resizes-content` is on the chat shell and `pageShell` viewport meta.
- `#composer-input` has `field-sizing: content` and `max-block-size: 8rem`; its text remains `1rem` (16px).

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/guest-composer-sizing.test.ts test/agent-mode-shell.test.ts test/shortlet-design-system.test.ts` — 19 tests, 19 passed, 0 failed.
- After committing the shell/CSS changes: `npx tsx --test test/landing-page.test.ts test/guest-kit.test.ts test/shortlet-design-system.test.ts` — 51 tests, 51 passed, 0 failed.
- Real Chrome: `npx tsx --test test/guest-composer-sizing-chromium.test.ts` — 2 tests, 2 passed, 0 failed (at 320 and 390 the composer and Send stay in view and text is 16px).
- Captures: `npx tsx .scratch/ux-guidelines/capture-25.ts` — 8 composer captures at 320/390/768/1280 in light and dark under `.scratch/ux-guidelines/screenshots/25/`; no overflow and no visible control under 44px.

## Answer

Guest pages resize for the on-screen keyboard and the composer uses progressive `field-sizing` with a bounded size, at 16px. The single-line input cannot grow vertically like the issue's textarea premise; that contradiction is recorded for a follow-up rather than forcing a broad interaction change.
