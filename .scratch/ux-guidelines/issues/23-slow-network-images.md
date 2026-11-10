# 23 · Images on slow networks

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 3 (Batch C)
Applicable ADRs: 0078; guideline §7 (reserve image space), §12 slow network

## What to build

- Give every guest image intrinsic `width` and `height`, including Weaver images, which today rely only on CSS `aspect-ratio`.
- Only the visible lead image is `loading=eager fetchpriority=high`; all others are lazy (keep `client.ts:280-288`, `listing-gallery.ts:30`). Check that no below-the-fold image is high priority.
- Add `srcset`/`sizes` where resized variants exist. Check whether the landing hero-image pipeline (`.scratch/landing-page/issues/19-hero-image-pipeline.md`) can produce listing variants; if it cannot, record that and skip.
- A broken image keeps the property name and facts visible (`.ui-stay-card__photo--empty`, `.photo-fallback`).

## Acceptance criteria

1. Every guest img element has width and height attributes
2. At most one image per screen has fetchpriority high
3. A failed image request leaves the Unit name, facts and total visible
4. Layout shift from images is zero on unit detail in a throttled real-Chrome run

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments
