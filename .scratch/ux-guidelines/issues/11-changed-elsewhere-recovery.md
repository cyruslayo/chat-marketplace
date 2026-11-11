# 11 · Recover from changed-elsewhere and artifact-mismatch responses

Status: resolved
Type: task
Blocked by: none
Phase: 1 (Batch A)
Applicable ADRs: 0072, 0074, 0106; guideline §6 (stale action), §9 (HTTP conflict)

## What to build

`renderResponse` in `apps/local-guest/src/client.ts` (~2535) handles `STALE_SURFACE`, `STALE_ACTION` and `EXPIRED_SURFACE`, but not `ARTIFACT_MISMATCH` or a version conflict. Those fall through to the generic message with no refresh.

- Route `ARTIFACT_MISMATCH` and conflict rejections to the stale path: mark the surface inert, call `refreshServerState`, and show "This request changed while you were viewing it. Check the latest status." Put the copy in `guest-content.ts`.
- Guards stay fail closed. A forged or unknown id must still be rejected on the server.

## Acceptance criteria

1. An ARTIFACT_MISMATCH rejection marks the surface out of date and refreshes the current state
2. The guest sees the changed-elsewhere message, never a raw code
3. A forged artifact id is still rejected after a cold restore
4. The draft entered before the rejection is not lost

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
| 0072 | A consequential action resolves to a platform command with a version check; a mismatch is refused. | AC1 and AC3: the server still rejects the forged or superseded artifact. |
| 0074 | A stale surface removes action authority, keeps a safe view and restores from server projections. | AC1: the surface becomes read-only and `refreshServerState` reloads the projection. |
| 0106 | Every Worker request is a cold restore; guards stay fail closed. | AC3: the forged id is refused after a cold restore. |
| 0080 | The conventional route carries the same facts. | The refreshed state is the same surface the standard route renders. |

### Implementation notes

- The client branch is a small pure helper, `changedElsewhereRecovery`, in `apps/local-guest/src/stale-surface-response.ts`. `client.ts` cannot be imported under Node, so the helper keeps AC1/AC2 testable without a browser. `renderResponse` and the criteria-strip refusal both use it.
- `ARTIFACT_MISMATCH` now gets the guest sentence "This request changed while you were viewing it. Check the latest status." and never the server's "does not match the authoritative artifact" text. `STALE_SURFACE`, `STALE_ACTION` and `EXPIRED_SURFACE` keep their existing server messages and now share the same branch.
- `CRITERIA_LOCKED` keeps its refresh behaviour alongside the new recovery path.
- This issue changed `client.ts` alone; no other `client.ts` issue ran in the same step. `client.js` was rebuilt and only the regenerated `dist/client.js` is staged.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/guest-changed-elsewhere.test.ts` — 4 tests, 4 passed, 0 failed.
- Affected: `npx tsx --test test/ci-browser-build.test.ts test/guest-internal-terms.test.ts test/guest-copy-pass.test.ts test/guest-shell.test.ts test/asset-loader.test.ts` — 20 tests, 20 passed, 0 failed.

## Answer

An `ARTIFACT_MISMATCH` (or any stale/conflict) rejection now marks the current surface out of date, refreshes the authoritative state, and shows the changed-elsewhere sentence instead of a raw code or internal message. The server still fails closed on a forged or superseded artifact id after a cold restore, and an authored draft survives the refusal unchanged.
