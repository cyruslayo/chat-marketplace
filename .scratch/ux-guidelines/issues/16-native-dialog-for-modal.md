# 16 · Native dialog for guest-path modals

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 2 (Batch B)
Applicable ADRs: 0078, 0081; guideline §8 (modal rules)

## What to build

Weaver's Modal renders a `div role=dialog` labelled "Modal dialog" (`renderers.js:292-303`), with no focus trap.

- **First,** find whether any guest-path A2UI surface emits Modal. If none does, record that and close this as no action.
- **Otherwise,** render it as a native `<dialog>` with `showModal()`, `closedby="any"` (where supported, with an Escape handler as fallback), a title from the component, and focus restored on close. Follow `apps/local-guest/src/listing-gallery.ts:204-343`. Fix it in `@cylayo/weaver-web` or the client, per the 13 decision.

## Acceptance criteria

1. Use of Modal on the guest path is recorded
2. If it is used, the modal is a native dialog with a meaningful accessible name
3. If it is used, focus moves into the modal on open and returns to the opener on close

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.

## Comments
