# 14 An expired confirmation is cleared, so the guest is not stuck

Status: resolved
Type: task
Track: C
Blocked by: none

## Defect

`#executePendingAction` in `apps/local-guest/src/assistant/assistant-runtime.ts` (near line 2071) refuses an expired pending action with `STALE_SURFACE` and the message "This action has expired or is no longer authorized.", but it leaves the action in place. So every later "yes" or button press gets the same refusal until the guest cancels.

## Fix

- **Expiry only** (`expiresAt <= now`, with thread, guest and tenant all matching):
  - Clear the pending action and supersede the pending-action surface in the same turn transaction, so the cleared state is committed.
  - Then return the same `STALE_SURFACE` code and message.
  - Reuse the way the cancel ("no") path clears a pending action.
- **Fail closed** for a thread, guest or tenant mismatch (a forged or foreign action): change nothing, keep today's refusal, and do not clear.

## Acceptance criteria

1. After an expired pending action is refused, the thread no longer holds that pending action, including after a cold restore.
2. After that refusal, the guest's next request (for example asking again to submit the request) produces a fresh pending action with a new id that can be confirmed.
3. A pending action presented with a different thread, guest or tenant is still refused with `STALE_SURFACE`, and the stored pending action is unchanged.
4. A non-expired pending action still executes exactly as before.

## Tests

- **Add or extend `test/assistant-pending-action-expiry.test.ts`.** Model it on `test/assistant-pending-action-restore.test.ts`:
  - assistant enabled;
  - a cold restore before every event;
  - the clock advanced past `expiresAt`, which is 15 minutes.
- **Re-run:**
  - `test/assistant-pending-action-restore.test.ts`
  - `test/assistant-thread-lock.test.ts`
  - `test/assistant-stage-handlers.test.ts`
  - `test/assistant-cold-journey.test.ts`
- **Then** `npm run check`.

ADRs: 0070, 0074, 0075, 0106.

## Comments

**Implementation (feat/state-machines-14, uncommitted, orchestrator commits).** Status left `ready-for-agent`: Definition of Done item 7 (`npm test` passes) is for the once-per-batch gate, not run here.

ADR table (0070, 0074, 0075, 0106):
- 0070 / 0074 (fail closed, surface authority): identity (thread, guest, tenant) and a finite expiry are still checked first. A mismatch returns `STALE_SURFACE` and changes nothing. Only an expired action of the matching identity is cleared.
- 0075 (no private material in diagnostics): no logging added. The clear signal is an in-memory flag.
- 0106 (cold restore re-keys, never re-mints): the cleared state is persisted by the shell, so a cold restore reads no pending action.

Changes:
- `assistant-runtime.ts` `#executePendingAction`: split the identity check from the expiry check. Expiry clears the action, supersedes the pending surface and commits (`#commitDroppedProposal`), then returns the same code and message. A new `#expiredPendingClears` set and `takeExpiredPendingClear(threadId)` tell the shell.
- `shortlet-app.ts`: `handleTurn` and `handleEventAsync` call `#persistExpiredPendingClear` only when that flag is set. It syncs `pendingAction` and writes the thread (`#persistRemoteThread` or `#persistThread`). A refused turn persisted nothing before this, so the cleared state was lost on a cold restore.
- `test/assistant-stage-handlers.test.ts` criterion 4, `expiry` case: it asserted the old defect ("the expiry mismatch leaves the proposal in place"). It now asserts the proposal is cleared. Other mismatches still assert it stays. This is the only change to an existing test.
- New `test/assistant-pending-action-expiry.test.ts`: four tests, one per AC, with a moving clock, assistant enabled and a cold restore before every event.

Before the fix (`env -u LLM_API_KEY npx tsx --test test/assistant-pending-action-expiry.test.ts`):
- AC1 FAILED at "the expired action is cleared after a cold restore": the restored thread still held `pa-891f3c30-...` (expiresAt 10:15Z, clock 10:16Z). The refusal assertions before it passed.
- AC2, AC3 and AC4 PASSED before the fix. AC2 passes because the replacement "Request the first one." overwrites the expired action, so it is a regression guard, not a failing test. AC3 and AC4 are guards too.

After the fix:
- `env -u LLM_API_KEY npx tsx --test test/assistant-pending-action-expiry.test.ts test/assistant-pending-action-restore.test.ts test/assistant-thread-lock.test.ts test/assistant-stage-handlers.test.ts test/assistant-cold-journey.test.ts`: `# tests 51 / # pass 51 / # fail 0`. Before the shell persistence was added, the same set gave 49 pass and 2 fail (AC1, and the stage-handler `expiry` assertion). That failure is why the shell step and the stage-handler update were needed.
- `env -u LLM_API_KEY npm run check`: exit 0, zero `error TS` lines, worker bundle guard passed.
- Not run, per the batch rule: `npm test`, `npm run test:workers`, real-Chrome files.

**Review fix (coordinator).** `#persistExpiredPendingClear` and its JSDoc now sit above the Issue 03 JSDoc, which is directly above `#syncPendingAction`. No other code change.
- `env -u LLM_API_KEY npx tsx --test test/assistant-pending-action-expiry.test.ts test/assistant-stage-handlers.test.ts`: `# tests 12 / # pass 12 / # fail 0`.
- `env -u LLM_API_KEY npm run check`: exit 0, zero `error TS` lines.
- Status set to `resolved`. The full `npm test` is the once-per-batch gate (AGENTS.md Test scope), so it is not run per issue. DoD item 7 is therefore covered by the batch gate, not here.
- Not committed.
