# 28 · Extended Stay collection and Notice to End copy

Status: ready-for-human
Type: task
Blocked by: 27
Phase: 4 (Batch D)
Applicable ADRs: 0092 (counsel gate)

## What to build

Guideline §11 asks the review and offer to say that later periods are not charged automatically, and to show the cancellation and Notice to End terms once approved. ADR 0092 leaves counsel-specific text as a gate.

- The owner supplies the approved wording.
- The agent then adds it to `guest-content.ts` and the screens from 27.
- Never draft legal text, and never use lease, tenancy, rent or landlord.

## Acceptance criteria

1. The approved wording is recorded here with its source
2. The offer and review show the wording for Extended Stays only
3. No guest string uses lease, tenancy, rent or landlord

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments
