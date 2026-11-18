# 17 Allow-list hardening for three latent deny-lists

Status: ready-for-agent
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
