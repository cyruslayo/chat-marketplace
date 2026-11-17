# 13 A stale or revoked offer does not restore as active

Status: resolved
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

Status set to `resolved` after the orchestrator-approved persistence change below (pending owner review). Every AC holds. The full `npm test` is the batch gate (AGENTS.md Test scope), not run per issue.

**Resolution (orchestrator approved, pending owner review).** `ConditionalOfferManager.acceptOffer` (`domains/shortlet/src/conditional-offer.ts`) now calls `this.#persistOffer(offer)` right after `offer.status = "stale"` and before the throw. Reason: a warm process already keeps the offer stale for its lifetime (the cached object is mutated). Persisting makes a cold restore match warm (ADR 0106) and keeps stale non-actionable (ADR 0074). The expired branch is unchanged.

**Post-approval runs:**
- `npx tsx --test test/offer-restore-status.test.ts test/guest-process-restart.test.ts test/guest-journey-rail.test.ts test/guest-offer-consistency.test.ts test/assistant-cold-journey.test.ts test/conditional-offer-token-restore.test.ts test/integrate-conditional-offer-application.test.ts test/render-conditional-offer-weaver-a2ui.test.ts test/issue-and-accept-conditional-booking-offer.test.ts`: 59 tests, 59 pass, 0 fail (AC1 now passes).
- `npm run check`: exit 0.
- Diff: `apps/local-guest/src/shortlet-app.ts` 8 lines, `domains/shortlet/src/conditional-offer.ts` 2 lines.

The earlier finding below is now resolved by the persistence change.

**Finding (blocks AC1).** `ConditionalOfferManager.acceptOffer` (`domains/shortlet/src/conditional-offer.ts`, the unit-eligibility branch near line 498) sets `offer.status = "stale"` on the cached offer and throws without calling `#persistOffer`. The store keeps `issued`. A cold restore therefore reads `issued` and restores `active`, even though the warm process shows the offer as stale. The expired state needs no write because it is projected from the clock. Stale and revoked are never persisted. Restore cannot show a stale offer after a cold restore until that branch persists the mark. This is a domain behaviour change (one `#persistOffer(offer)` call before the throw). It needs owner or orchestrator approval; it was not made here.

**Fixture note.** `restartFixture` uses the in-memory `UnitRepository` (`apps/local-guest/src/fixture.ts`, `openNode`), so a unit eligibility change does not survive a restart. AC4 re-applies `flagMaterialUnitChange` to the restarted environment.

**Change.** `apps/local-guest/src/shortlet-app.ts`, `#restoreCurrentSurface` offer branch: `status` is now `expired` for expired, `stale` for stale or revoked, and `active` otherwise. The existing summary and copy are unchanged. No new strings.

**Commands and results (run from `C:\AI2026\chat-marketplace-sm-13`, prefixed `env -u LLM_API_KEY`):**
- Before fix: `npx tsx --test test/offer-restore-status.test.ts`. AC1 fails: `a stale offer must not restore as active` (expected not `active`, actual `active`). AC2 and AC3 pass. AC4 fails with `true !== false` because the restart discarded the unit change, so the accept succeeded. Fixed by the fixture note above.
- After fix and fixture note, same file: 4 tests, 3 pass, 1 fail (AC1, the durability gap above).
- `npx tsx --test test/offer-restore-status.test.ts test/guest-process-restart.test.ts test/guest-journey-rail.test.ts test/guest-offer-consistency.test.ts test/assistant-cold-journey.test.ts`: 42 tests, 41 pass, 1 fail (AC1 only).
- `npm run check` (tsc, cloudflare tsconfigs, worker bundle guard): exit 0, zero errors.

**Acceptance criteria.** AC1 fails (durability gap). AC2 and AC3 pass. AC4 passes. Definition of Done item 7 (`npm test`) not run, per the per-issue scope.
- Orchestrator review: diff read; re-ran the 9 files (59 pass) and `npm run check` (exit 0). The `#persistOffer` on stale was approved by the orchestrator, not the owner; it is called out for owner review in the batch summary. The restored stale summary keeps the existing "Conditional Booking Offer" wording (no new copy).
