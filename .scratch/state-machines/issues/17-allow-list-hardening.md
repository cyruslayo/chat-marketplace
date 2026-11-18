# 17 Allow-list hardening for three latent deny-lists

Status: resolved
Type: task
Track: C (latent, not reachable through any live path today)
Blocked by: 05, 06, 07, 08

## Defect

Three guards are deny-lists. A deny-list admits any move it does not name, so a corrupt or unexpected state passes straight through. No live flow reaches these paths today, but each one fails open.

1. **`resolveExpiry`** in `domains/shortlet/src/bank-transfer.ts` skips only `expired` and `refunded`. A `completed` session would therefore be moved to `expired`, which also releases payment-pending inventory and the live attempt for a paid booking. Its only in-domain caller is already guarded by the "already processed" check. The wrapper `BankTransferApplication.resolveExpiry` in `apps/web/src/bank-transfer-application.ts` has no live callers.
2. **`commitAmendment`** in `domains/shortlet/src/booking-amendment.ts` refuses only `committed` and `rejected` (`STALE_ACTION`), then `proposed`. An `expired` amendment re-checks its deadline today, but the guard itself admits it.
3. **`packages/platform-core/src/surface.ts`**: `updateSurfaceProjection`, `expireSurface`, `supersedeSurface` and `deleteSurface` have no from-state check. A `deleted` surface can become `stale`, `expired` or `superseded`, against ADR 0074.

## Fix

Use allow-lists.

**1. `resolveExpiry`**
- Only `initiated` and `processing_in_grace` may expire.
- `expired` and `refunded` keep today's idempotent early return (the session unchanged).
- `completed` gets the same early return: leave the session unchanged, release nothing, and write no audit.
- Remove `completed` → `expired` from `BANK_TRANSFER_SESSION_TRANSITIONS`, along with its `// issue 17` comment.

**2. `commitAmendment`**
- Only `accepted` and `awaiting_financial_settlement` may proceed past the guard.
- `proposed` keeps its existing "Explicit guest acceptance is required" error.
- Every other status, `expired` included, throws `STALE_ACTION`, as `committed` and `rejected` do today.
- If an amendment status table exists or is cheap to add, add `AMENDMENT_TRANSITIONS` with `satisfies TransitionTable` and use `canTransition`.
- Leave `status` and `lifecycleStatus` both in place (owner territory).

**3. `surface.ts`**
- Add `SURFACE_LIFECYCLE_TRANSITIONS`, built from the moves the code makes today. Read the callers, including `executeSurfaceAction`.
- `deleted` and `superseded` are terminal.
- A refused move is a no-op that leaves the surface unchanged, with no throw. Platform callers do not expect throws there; confirm this by reading the callers.
- `updateSurfaceProjection` on a terminal surface is also a no-op.

**General**
- Record each refused-move outcome in the map row.
- The journey stage writes marked "issue 17" by issue 07 are **out of scope** here: guarding them needs owner decisions. Replace the "issue 17" in those comments with "issue 27". Add issue 27 to `.scratch/state-machines/map.md` as "Guard the unguarded payment-journey stage writes (owner decisions per pair, incl. deposit retry returning to stay_payment_active)", status `needs-info`.

## Acceptance criteria

1. Calling `resolveExpiry` on a `completed` bank-transfer session leaves it `completed`, releases no inventory and no attempt, and writes no `bank_transfer.expired` audit.
2. `resolveExpiry` on `initiated` or `processing_in_grace` past grace still expires exactly as before, and on `expired` or `refunded` still returns the session unchanged.
3. `commitAmendment` on an `expired` amendment throws `STALE_ACTION`. `accepted` and `awaiting_financial_settlement` still commit as before, and `proposed` still throws "Explicit guest acceptance is required".
4. A `deleted` surface stays `deleted` after `expireSurface`, `supersedeSurface` and `updateSurfaceProjection`. An `active` surface still moves to `expired`, `superseded` and `deleted` as before.

## Tests

1. **Failing tests first.** Write `test/allow-list-hardening.test.ts`, one `test()` per acceptance criterion. Use these fixtures:
   - bank transfer: the existing `test/payment-session-transitions.test.ts` setup;
   - amendment: search `test/` for `commitAmendment` and `amend-material-booking-terms`;
   - surface: `test/surface-lifecycle-extension.test.ts`.
2. **Re-run** every test whose name contains `bank-transfer`, `amend`, `surface-lifecycle` or `payment-session`, plus `test/payment-journey-stages.test.ts` and `test/state-machine-inventory.test.ts`.
3. **Run `npm run check`.**

ADRs: 0044, 0045, 0047, 0060, 0074.

## Comments

### Implementation (agent, Haiku 5.5)

**ADR table (protocol steps 2 and 4).** Read: 0044, 0045, 0047, 0060, 0074.

| ADR | Constraint used | Code path and criterion |
|---|---|---|
| 0044 | Payment Window and grace; a paid session is not expired by a reservation release | AC1, AC2: `BankTransferPaymentManager.resolveExpiry` allow-list |
| 0045 | Late success refunded in full; expired and refunded are terminal for expiry | AC2: unchanged early return; `#lateRefund` untouched |
| 0047 | Expiring booking-specific transfer; expiry releases only the unpaid session | AC1, AC2; `BANK_TRANSFER_SESSION_TRANSITIONS` (`completed: []`) |
| 0060 | Versioned amendments commit only from accepted or awaiting settlement | AC3: `AMENDMENT_TRANSITIONS` and `canTransition` in `commitAmendment` |
| 0074 | Fail-closed surface lifecycle; deleted and superseded terminal; refused move is a no-op | AC4: `SURFACE_LIFECYCLE_TRANSITIONS` in `expireSurface`, `supersedeSurface`, `deleteSurface`, `updateSurfaceProjection` |

**Caller analysis (before the surface moves became no-ops).** Grep over the whole repo, excluding node_modules.

- `expireSurface`: `test/render-and-expire-first-generative-surface.test.ts:65` (active to expired, then expects the action to throw "expired"). No production caller.
- `supersedeSurface`: `test/surface-lifecycle-extension.test.ts:20` (active to superseded). No production caller.
- `deleteSurface`: `test/surface-lifecycle-extension.test.ts:25` (active to deleted). `apps/local-guest/src/client.ts:2196` and `test/weaver-web-agent-adapter.test.ts:65` use a Weaver protocol message field named `deleteSurface`, a different API that does not call `GenerativeSurfaceManager`. Not affected.
- `updateSurfaceProjection`: `test/render-and-expire-first-generative-surface.test.ts:54`, `:79` (lower version, active to stale), `:84`. No caller updates a deleted or superseded surface.
- Result: no caller relies on a throw from a refused move or on moving a terminal surface. "Surface not found" still throws for unknown ids. `refreshLifecycle` is unchanged.
- Bank transfer `resolveExpiry` callers: `bank-transfer.ts` `#process` (pending past grace; a completed reference returns early or throws before reaching it), `apps/web/src/bank-transfer-application.ts:99` (wrapper, no live callers), and tests.
- Amendment `commitAmendment` callers: `apps/web/src/booking-amendment-application.ts:10` (passes the throw through) and `apps/web/src/booking-amendment-actions.ts:46,61` (maps message `STALE_ACTION` to the `STALE_ACTION` code). Behaviour change, as AC3 requires: an expired amendment previously surfaced "Amendment completion deadline has passed" (mapped to `ACTION_NOT_AUTHORIZED`) and now surfaces `STALE_ACTION`.

**Changes.**

- `domains/shortlet/src/bank-transfer.ts`: `completed` lists no moves; `completed -> expired` removed from `BANK_TRANSFER_SESSION_TRANSITIONS`; `resolveExpiry` guards with `canTransition(..., "expired")`. The `// issue 17` comments are removed; the journey-stage comments are renamed to issue 27.
- `domains/shortlet/src/booking-amendment.ts`: new `AMENDMENT_TRANSITIONS` (`satisfies TransitionTable<PendingAmendment["status"]>`). `commitAmendment`: a missing id throws `STALE_ACTION`; `proposed` keeps "Explicit guest acceptance is required"; other statuses are checked by `canTransition(..., "committed")`. `status` and `lifecycleStatus` are unchanged.
- `packages/platform-core/src/surface.ts`: new `SURFACE_LIFECYCLE_TRANSITIONS` (`satisfies TransitionTable<SurfaceLifecycleStatus>`). Moves: active to stale, expired, superseded, deleted; stale and expired to expired, stale, deleted; deleted and superseded terminal. `fallback` lists no moves because no code path creates or leaves it. A refused move returns without throwing. Error strings are unchanged.
- Journey-stage writes in `card-payment.ts`, `bank-transfer.ts` and `booking-payment-journey.ts` now say "issue 27" (not guarded here).
- `.scratch/state-machines/map.md`: issue 17 is `resolved`; issue 27 added (Track C, status `needs-info`, no blocked-by). The bank-transfer, amendment and surface rows record the refused-move outcomes. `docs/agents/state-machines.md` guard-style cells are updated to match.
- Tests: `test/allow-list-hardening.test.ts` (new, one test per AC). The bank-transfer fixture (`paymentOffer`, `envelope`, `T0`/`at`, `bankSetup`, `providerSuccess`) moves to `test/helpers/bank-transfer-session-fixture.ts` and is shared with `test/payment-session-transitions.test.ts`. That file's `completed -> expired` positive assertion becomes a negative one, and its unused imports are removed. The amendment fixture is a minimal copy of the contract literal from `test/amend-material-booking-terms.test.ts`, which is not exported. This is the only duplication, recorded here rather than extracted.

**Commands and results** (from `/c/AI2026/chat-marketplace-sm-17`, each prefixed with `env -u LLM_API_KEY`).

1. Before the fix: `npx tsx --test test/allow-list-hardening.test.ts`. Result: 3 pass, 3 fail. Red: AC1 `completed` expected, `expired` actual (`resolveExpiry` moved a paid session). AC3 second commit on an expired amendment threw "Amendment completion deadline has passed", not `STALE_ACTION`. AC4 `deleted` expected, `expired` actual after `expireSurface`. Green before the fix, as characterisation: AC2, AC3 proposed, AC4 active. A first run failed on a fixture bug (`options is not defined`), fixed before this run and not counted.
2. After the fix: `npx tsx --test test/allow-list-hardening.test.ts`. Result: 6 pass, 0 fail.
3. Affected tests, one command: `npx tsx --test test/allow-list-hardening.test.ts test/amend-material-booking-terms.test.ts test/integrate-bank-transfer-application.test.ts test/integrate-booking-amendment-application.test.ts test/payment-journey-stages.test.ts test/payment-session-transitions.test.ts test/render-bank-transfer-weaver-a2ui.test.ts test/render-booking-amendment-weaver-a2ui.test.ts test/state-machine-inventory.test.ts test/surface-lifecycle-extension.test.ts test/surface-lifecycle-single-union.test.ts test/expire-transfer-and-refund-late-payment.test.ts test/render-and-expire-first-generative-surface.test.ts`. Result: 80 pass, 0 fail, 0 cancelled, 0 skipped. The last two files are included because they call `resolveExpiry`, `expireSurface` and `updateSurfaceProjection`.
4. `npm run check`: exit 0 (root `tsc --noEmit`, `apps/cloudflare`, its test and tooling tsconfigs, and the worker bundle guard).
5. Not run: the full `npm test`, `npm run test:workers` and real-Chrome files. These are the batch gate.

**Definition of Done.**

1. Each AC has a named test that mirrors its text: yes (`test/allow-list-hardening.test.ts`).
2. Failure paths are asserted: AC1 (completed unchanged, no release, no audit), AC3 (STALE_ACTION on expired, the proposed message), AC4 (deleted unchanged). Yes.
3. ADRs cited above, with the table: yes.
4. No new injected dependency: yes (no new constructor parameters).
5. No invented policy: the tables are derived from the moves in the code, and the ADRs are cited. Yes.
6. No bearer credentials in audit or logs: no audit or log text was added. Yes.
7. `npm run check` passes: yes. The full `npm test` is the batch gate, not run per issue, so this item stays open until the batch gate passes.

**Open or unconfirmed.** The batch gate (full `npm test`, `npm run test:workers`) has not run. The issue 27 track (C) and the empty blocked-by value were chosen by the agent; the issue text does not state them. `status` and `lifecycleStatus` duplication is deliberately left in place, per the issue.
- Orchestrator review: diff read; `fallback` is never assigned and the surface manager has no production caller, so the no-op rule changes no live path. The expired-amendment case now maps to the stale-action code in apps/web (named AC3 change). Re-ran 71 tests (pass) and `npm run check` (exit 0).
