# 19 · Explicit surface-kind and field-purpose hooks

Status: ready-for-agent
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
