# Move the Shortlet public API and `validatedCheckOutForNights` out of the assistant runtime

Status: needs-triage
Type: task
Blocked by: 04
Requested: 28 Oct 2026
PRD: `../PRD.md`

## Why

Issue 04 moved the Shortlet pack out of `AssistantRuntime` (owner decision b, commit `03a3465`: the host composes the pack, and the proposal-authority rule is a pack hook). Six Shortlet methods and one Shortlet import stayed on the runtime, because `shortlet-app.ts` calls them directly. The owner accepted this as a follow-up:

- `restoreShortletState`, `recordGuestStay`, `recordGuestArea`, `selectShortletUnit`, `clearShortletSelection`, `applyDiscoveryShortlist` (public methods, `apps/local-guest/src/assistant/assistant-runtime.ts`);
- the `validatedCheckOutForNights` import from `./shortlet-assistant-pack.js` (used by `recordGuestStay`);
- the `"shortlet"` domain literal in `restoreShortletState`, which finds the Shortlet task by name;
- the restored pending-card id template in `restoreShortletState`.

These are the last domain-specific names in the platform file. ADR 0099 section 4 says packs declare and do not reach in, and section 6 says the host is the composition root.

The boundary test (`test/assistant-runtime-boundary.test.ts`) records each as a named, counted exception with `followUp` pointing here. Removing an exception without moving the code fails that test.

## What to build

1. **Move the methods behind the Shortlet pack.** The Shortlet pack exposes the state operations the host needs (restore a Shortlet task, record stay facts, record an area, select or clear a unit, apply a discovery shortlist). `shortlet-app.ts` calls the pack, not the runtime.
2. **A platform-owned task-state port.** The runtime exposes a generic, pack-agnostic operation to read and replace the active task's state for a thread. The pack's operations use it. The runtime names no Shortlet state field.
3. **`validatedCheckOutForNights` moves into the pack.** `recordGuestStay`'s checkout derivation runs in the pack. The runtime does not import it.
4. **Find the Shortlet task by its pack, not by name.** `restoreShortletState`'s `entry.domain === "shortlet"` becomes a lookup by the pack's own id, supplied by the pack.
5. **Re-key the restored pending card with a platform function.** The `thread-…:pending-action:…` template moves to one platform helper, shared with the pending-card projection.
6. **Extend the boundary test.** Any method on `AssistantRuntime` whose name contains `Shortlet`, or whose body names a Shortlet pack, a Shortlet module or the `"shortlet"` literal, fails. The allowlist entries for this issue must be removed when it closes; an entry that remains fails the exact-match test.
7. **No behaviour change.** No recording and no expected value is edited.

## ADRs

| ADR | Constraint | Affects |
|---|---|---|
| 0099 section 4 | Packs declare; the platform consumes declarations and does not reach in | Every moved method, the task-state port |
| 0099 section 6 | The host is the composition root | `shortlet-app.ts` calls the Shortlet pack's operations |
| 0074 | A proposal's authority is decided by the pack's hook, and fails closed | `applyDiscoveryShortlist` and the restore path |
| 0106 | Cold restore re-keys the ids the guest holds (never re-mints them); discovery artifact authority | `restoreShortletState`, the pending-card id |
| 0092, 0093 | Extended stays and guest accounts (cold-restore context) | `recordGuestStay`, `restoreShortletState` |

## Acceptance criteria

1. The runtime defines no method whose name contains `Shortlet`, and imports nothing from a Shortlet module (boundary test, extended for methods).
2. `shortlet-app.ts` reaches the Shortlet state only through the Shortlet pack or the host.
3. `validatedCheckOutForNights` is not imported by the runtime. Its checkout derivation runs in the pack, with the same result for the same input.
4. `restoreShortletState` finds the Shortlet task by the pack's id. With no Shortlet task or no Shortlet pack, it refuses (`false`), as it does today.
5. The restored pending-card id is produced by the platform helper, and a mismatched id is still not restored (fail closed, ADR 0106).
6. The boundary allowlist has no entry that cites this issue.

## Tests

- `test/assistant-runtime-boundary.test.ts`: method-name and import scans, and the exact allowlist.
- `test/assistant-cold-journey.test.ts`, `test/assistant-turn-stop-cold-restore.test.ts`, `test/assistant-persistent-continuity.test.ts`, `test/guest-restart.test.ts` (if present), `test/assistant-search-unknowns.test.ts`: must pass unchanged.
- `test/assistant-recorded-journeys.test.ts` and `test/assistant-recording-clients.test.ts`: unchanged recordings.
- Any `shortlet-app.ts` caller changed by this issue: the test that drives it.

## Comments
