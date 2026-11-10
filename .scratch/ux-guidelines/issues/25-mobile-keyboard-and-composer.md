# 25 · Mobile keyboard and composer sizing

Status: ready-for-agent
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
