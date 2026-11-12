# 13 · Apply A2UI accessibility labels in the browser

Status: resolved
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

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0074 | Rich UI is optional; rendered semantics must carry the meaning. | AC1-AC3: the browser applies the label the renderer ignores. |
| 0078 | WCAG 2.2 AA, accessible names, keyboard and screen-reader use. | AC1 and AC3. |
| 0081 | Weaver is the web runtime; catalog behaviour is platform-owned. | The client-side pass wraps the approved runtime without changing its catalogue. |

### Owner decision and implementation

The owner maintains `@cylayo/weaver-web`, but the published 0.2.1 (pinned here) and 0.3.1 both ignore the A2UI `accessibility` metadata, and no newer release exists. The owner approved the client fallback for this effort. `apps/local-guest/src/a2ui-accessibility.ts` reads the Button's `accessibility.label` and its visible child Text from the surface messages; after Weaver mounts, `client.ts` sets `aria-label` in component order. When the visible text is not already in the server label (for example "View apartment" versus "View <unit>"), the name is `"<visible>: <server label>"`, so the visible label stays contained (WCAG 2.5.3). A component without a label is untouched and keeps its visible-text name.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/a2ui-accessibility.test.ts test/guest-modal-usage.test.ts` — 3 tests, 3 passed, 0 failed.
- Real Chrome: `npx tsx --test --test-name-pattern "Issue 13 AC1" test/guest-discovery-consistency-chromium.test.ts` — 1 test, 1 passed, 0 failed (the View action's accessible name includes "View apartment" and the unit name).
- `client.js` rebuilt; only the regenerated `dist/client.js` is staged.

## Answer

The browser now applies A2UI accessibility labels after mount. A discovery card's View action has an accessible name that includes the Unit name while keeping "View apartment" inside it; an unlabelled component keeps its visible-text name; and every labelled control keeps its visible label inside the accessible name. The fix is a client-side pass because the published Weaver release still ignores the metadata.
