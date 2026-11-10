# 19 · Explicit surface-kind and field-purpose hooks

Status: resolved
Type: task
Blocked by: none
Phase: 2 (Batch B)
Applicable ADRs: 0074, 0081, 0106

## What to build

The client guesses the surface kind from substrings of the surface id (`client.ts` ~1905), and the contact field from a label regex (`enhanceGuestContactField`, ~1670). Both break silently when ids or copy change.

- Have the server emit an explicit surface kind and field purpose: a closed enum in the surface metadata, or a data attribute that the presentation layer sets.
- Switch the client to read it, with no fallback guessing.

## Acceptance criteria

1. Every guest surface type carries an explicit kind, and the client reads it instead of the id
2. The phone and email fields get tel/email inputmode and autocomplete from their declared purpose, not their label text
3. Changing a surface id prefix or a field label does not change the enhancement, as a test shows
4. Kinds and purposes survive a cold restore

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Assistant path: read ADR 0106 in full first. Tests run with the assistant runtime enabled and a cold restore (a new `LocalGuestApp` over the same store) before every event, on a fresh thread, with a staging-like clock (2026-10-27) and guest. `test/assistant-cold-journey.test.ts` is the model.
- This issue changes `apps/local-guest/src/client.ts`. Never run it alongside another `client.ts` issue (11, 14, 19, 21, 24). Rebuild `client.js` and commit the regenerated `dist/client.js` only.

## Comments

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0074 | Surfaces have durable identity and fail-closed placement; the browser does not guess meaning. | AC1 and AC3. |
| 0081 | Weaver renders platform-produced surfaces; presentation stays platform-owned. | The client reads server metadata, not copy or ids. |
| 0106 | Cold restore rebuilds both shell and runtime; ids and kinds must survive. | AC4. |

### Implementation

- `GuestSurfacePayload` carries `kind` (a closed enum) and `contactPurpose`. The server sets them in the contact, discovery, request, draft, payment and confirmed-booking builders; `#decorateResult` fills any remaining surface from explicit content markers, with the id only as a server-side last resort.
- `modeFor` and `renderSurface` read `surface.kind`; the client no longer inspects `surfaceId` for the kind or placement.
- `enhanceGuestContactField` takes `surface.contactPurpose` and never reads the label text. `contactFieldAttributes` centralises tel/email `type`, `inputMode` and `autocomplete`.
- The discovery card test now opens at 1600: at 1280 the workspace column is below 48rem, so issue 18's container rule shows the compact rows instead of cards. The card assertion is unchanged where cards render.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/guest-surface-hooks.test.ts` — 4 tests, 4 passed, 0 failed.
- Affected: `npx tsx --test test/assistant-cold-journey.test.ts test/guest-copy-pass.test.ts test/assistant-artifact-authority.test.ts test/guest-surface-hooks.test.ts` — 24 tests, 24 passed, 0 failed.
- Real Chrome: `npx tsx --test --test-name-pattern "Issue 13 AC1" test/guest-discovery-consistency-chromium.test.ts` — 1 test, 1 passed, 0 failed.
- `client.js` rebuilt; only the regenerated `dist/client.js` is staged.

## Answer

The server declares each surface's kind and each contact field's purpose. The client reads them for placement and field semantics, never an id prefix or a label, and both survive a cold restore. A renamed id prefix or a changed label does not change the enhancement.
