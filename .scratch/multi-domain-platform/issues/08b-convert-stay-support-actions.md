# Convert stay-support actions to ActionSpec

Status: resolved
Type: task
Blocked by: 07
Requested: 14 Oct 2026
Unlocks: 09b
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

Finish removing the duplicated gate (PRD, Diagnosis 3).

## What to build

Convert to `ActionSpec`, keeping exported event names and result types:
`apps/web/src/checkin-support-actions.ts`, `checkout-overstay-actions.ts`, `mid-stay-failure-actions.ts`, `relocation-actions.ts`, `deposit-claim-actions.ts`, `guest-conduct-actions.ts`, `human-handoff-actions.ts`, `discovery-actions.ts`. Remove the duplicated stale checks from `checkout-overstay-application.ts`, `deposit-claim-application.ts`, `mid-stay-failure-application.ts`, `protection-fund-application.ts`, `protection-fund-relocation-adapter.ts`, `relocation-application.ts` where they are the same gate. If `discovery-actions.ts` does not fit `ActionSpec`, record why in `## Comments` and leave it.

## Out of scope

- Booking-funnel actions (08a).

## Acceptance criteria

- AC1: Each converted file contains no gate logic.
- AC2: All existing tests for these flows pass unchanged.
- AC3: No `STALE_ACTION` gate implementation remains outside `packages/platform-core` (except any documented discovery exception).

## Tests

Existing flow tests; one gate test per converted spec for its stale path.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0076-suspend-automation-during-human-takeover.md` | Handoff actions keep suspension semantics. |
| `docs/adr/0017-give-guests-forty-eight-hours-to-answer-deposit-claims.md` | Deposit claim deadlines unchanged. |
| `docs/adr/0028-let-guests-choose-relocation-or-refund.md` | Relocation choice unchanged. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Answer

Converted the seven stay-support action files to `ActionSpec`s on the platform gate; `discovery-actions.ts` is left unconverted (see Comments).
- `checkin-support-actions.ts`, `checkout-overstay-actions.ts`, `mid-stay-failure-actions.ts`, `relocation-actions.ts`, `deposit-claim-actions.ts`, `guest-conduct-actions.ts`, `human-handoff-actions.ts`.

Gate additions (still one mechanism): `context.pattern` (checkout `requestedTime`), `context.min` (mid-stay/relocation `>= 1` versions), optional `command` (the gate envelopes only when a spec declares a command; the domain method otherwise owns command creation), optional `artifact.schemaVersion` (deposit-claim and guest-conduct artifacts carry `schema`), and `artifact.loadRejectedCode` so a load-time `STALE_ACTION` is preserved.

Tests:
- `test/slice-08b-converted-action-specs.test.ts` — AC1 "Each converted stay-support file contains no gate logic and declares only its spec and domain call" (no `contextOf`/`readContext`/`parseContext`, no local `reject`), plus the documented discovery exception.
- AC2 "All existing tests for these flows pass unchanged" — `integrate-{mid-stay-failure,deposit-claim,human-handoff,checkin-support,guest-conduct,checkout-overstay}-application`, `enforce-standardized-guest-conduct`, `enforce-checkout-late-checkout-and-overstay`, `render-relocation-weaver-a2ui`, `discovery-{actions,interactions}` all pass (93 green).
- AC3 "No `STALE_ACTION` gate implementation remains outside `packages/platform-core` (except the discovery exception)" — the gate's ordered checks (context allow-list, kind/schema, stale comparison, rejection codes) now exist once in `interactions.ts`; the converted files only declare `crossMatch`/`expect`/`runRejectedCode`.

Verification: `npm run check` clean. `npm run test:non-browser` phase 1: 1747 pass / 4 pre-existing failures (reproduce on baseline; see slice 06).

## Comments

- 14 Oct 2026 (agent): `discovery-actions.ts` is left as-is per the slice. It yields an `open-conventional-route` effect (not a refreshed artifact) and owns an `INVALID_ROUTE` route-safety check that the artifact gate does not model; converting it would mean giving the gate an effect-returning shape, which is a different interface (candidate for a later slice).
- 14 Oct 2026 (agent): `human-handoff-actions.ts` authenticates with a `SecurityContext`, not a `CommandPrincipal`. The gate's principal contract is `CommandPrincipal`; the spec closes over the `SecurityContext` for load/run and the resolver passes a synthesized gate principal used only for the gate's own checks. No command envelope is created (the spec declares none; the thread manager owns its command path).
- 14 Oct 2026 (agent): Left the domain revalidations in `checkout-overstay-application.ts`, `deposit-claim-application.ts`, `mid-stay-failure-application.ts`, `relocation-application.ts` and the protection-fund/relocation adapters. They re-read authoritative state inside the domain (last-line defence in depth), not a copy of the gate sequence.
- 14 Oct 2026 (agent): `guest-conduct-actions.ts` now requires the reviewed-decision fields in the `apply-reviewed-decision` spec's schema, so a missing field is `INVALID_CONTEXT` at parse time rather than after the stale check. The rejection code is unchanged; only the ordering for a request that is both stale and malformed differs.
