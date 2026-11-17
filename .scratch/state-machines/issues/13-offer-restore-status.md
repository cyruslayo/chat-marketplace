# 13 A stale or revoked offer does not restore as active

Status: ready-for-agent
Type: task
Track: C
Blocked by: none

## Defect

The offer branch of `#restoreCurrentSurface` in `apps/local-guest/src/shortlet-app.ts` sets the surface `status` to `"expired"` only when the offer is expired. It is near line 3188: `summary: offerArtifact.facts.status === "expired" ? ...`. Every other offer status becomes `"active"`, including `stale` and `revoked`.

The journey rail (`#journeyFor`) and `apps/web-agent/src/offer-presentation.ts` treat `stale` and `revoked` as closed. So after a cold restore, the guest sees a closed offer presented as live. That breaks ADR 0074.

## Fix

Derive the restored surface status from the offer status:

| Offer status | Restored surface status |
|---|---|
| `issued` | `active` |
| `accepted` | Unchanged from current behaviour. Read the code first: if accepted offers restore through the payment branch first, leave that alone. |
| `expired` | `expired` |
| `stale`, `revoked` | `stale` |

- For `stale` and `revoked`, use the closed wording that `offer-presentation.ts` already produces. Reuse it; do not write new copy.
- Look at how the live (non-restore) path renders a stale offer, and match it.

## Acceptance criteria

1. After a cold restore, a `stale` offer comes back with a non-actionable surface status (not `active`), matching the rail.
2. After a cold restore, an `issued` offer within its Payment Window comes back `active`, exactly as before.
3. An expired offer comes back `expired`, exactly as before.
4. A Conditional Offer action submitted against the restored stale surface is refused (`STALE_SURFACE` or the existing offer refusal). It is never accepted.

## Tests

- **Add `test/offer-restore-status.test.ts`.**
  - To make an offer stale, see how `conditional-offer.ts` sets `stale`: a unit eligibility change on accept. Search `test/` for an existing fixture that does this (look for `"stale"` near `offer`).
  - Do a cold restore before every event.
- **Re-run:**
  - `test/guest-process-restart.test.ts`
  - `test/guest-journey-rail.test.ts`
  - `test/guest-offer-consistency.test.ts`
  - `test/assistant-cold-journey.test.ts`
- Run `npm run check`.

ADRs: 0074, 0106.

## Comments
