# 14 An expired confirmation is cleared, so the guest is not stuck

Status: ready-for-agent
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
