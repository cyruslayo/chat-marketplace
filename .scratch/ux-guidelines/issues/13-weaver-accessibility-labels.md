# 13 · Apply A2UI accessibility labels in the browser

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 2 (Batch B)
Applicable ADRs: 0074, 0078, 0081 (Weaver runtime); guideline §6 item 10, §12

## What to build

The A2UI builders set `accessibility: { label }` (for example `apps/web-agent/src/discovery-a2ui.ts:171,280,331,435`). No `@cylayo/weaver-web` renderer applies it, and `renderButton` (`node_modules/@cylayo/weaver-web/dist/basic/renderers.js:347`) ignores it. Accessible names come only from visible text and client patches.

- **First,** ask the owner whether they maintain `@cylayo/weaver-web`. If they do, fix it in the package (apply `aria-label`, or `aria-describedby` when visible text exists) and bump the version. If they do not, add a post-mount pass in `client.ts` keyed on the component id.
- Prefer `aria-describedby` when a visible label already names the action, so the visible and accessible names agree (WCAG 2.5.3).

## Acceptance criteria

1. A discovery card's View action has an accessible name that includes the Unit name, read from the Chrome accessibility tree
2. A component without an accessibility label keeps its visible-text name
3. The visible label text is contained in the accessible name for every labelled control

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Real Chrome: run the touched real-Chrome test file alone, never two at once.

## Comments
