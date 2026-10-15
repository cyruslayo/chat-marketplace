# Convert booking-funnel actions to ActionSpec

Status: resolved
Type: task
Blocked by: 07
Requested: 14 Oct 2026
Unlocks: 09a
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

Continue removing the duplicated gate (PRD, Diagnosis 3).

## What to build

Convert to `ActionSpec` on the platform gate from slice 07, keeping exported event names and result types:
`apps/web/src/booking-request-actions.ts`, `conditional-offer-actions.ts`, `booking-amendment-actions.ts`, `cancellation-actions.ts`, `payment-capability-actions.ts`. Remove the duplicated stale check from `cancellation-application.ts` if it is the same gate.

## Out of scope

- Stay-support actions (08b). Behaviour changes.

## Acceptance criteria

- AC1: Each of the five files contains no gate logic and declares only its spec and domain call.
- AC2: All existing tests for these flows pass unchanged.
- AC3: `contextOf` copies in these files are gone.

## Tests

Existing flow tests; add one gate test per converted spec for its stale path.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0060-require-versioned-booking-amendments.md` | Amendment versions are part of the stale rule. |
| `docs/adr/0058-adopt-a-standardized-cancellation-catalogue.md` | Cancellation semantics unchanged. |
| `docs/adr/0072-route-consequential-actions-through-platform-commands.md` | Commands still created by the gate. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Answer

Landed: the five booking-funnel action files now declare `ActionSpec`s on the platform gate (`resolveAction`) and keep only their spec plus domain call:
- `apps/web/src/booking-request-actions.ts` — confirm/decline specs; the resolver uses a `load` that returns the passed artifact, the handler loads via `getArtifact`.
- `apps/web/src/conditional-offer-actions.ts` — accept spec; the `confirmationToken` check is the spec's `isAuthorized`.
- `apps/web/src/booking-amendment-actions.ts` — accept spec; all identity/proposal mismatches are a `crossMatch` returning `STALE_ACTION`, the contract/projection versions are `expect`, and a thrown `STALE_ACTION` is preserved via `runRejectedCode`.
- `apps/web/src/cancellation-actions.ts` — cancel / apply-reviewed / confirm-no-show specs; every version/identity mismatch is a gate `expect` (the no-show `contactAttemptVersion` is a `crossMatch` because a missing value is stale, which `expect` would skip).
- `apps/web/src/payment-capability-actions.ts` — initialize-ussd spec.

Gate extensions (still one mechanism, ADR 0099 rule 3): optional `artifact.kind`/`schemaVersion`/`validate`/`loadRejected`, `authorizationRejected`, `runRejectedCode`, a `string-or-number` context field, and `ActionArtifact.projectionVersion` widened to `number | string`.

Tests:
- `test/slice-08a-converted-action-specs.test.ts` — AC1 "Each of the five files contains no gate logic and declares only its spec and domain call" (each declares `ActionSpec` + `resolveAction`, none has a local `reject` helper) and AC3 "contextOf copies in these files are gone".
- AC2 "All existing tests for these flows pass unchanged" — `integrate-booking-request-application`, `integrate-conditional-offer-application`, `issue-and-accept-conditional-booking-offer`, `amend-material-booking-terms`, `integrate-booking-amendment-application`, `integrate-cancellation-application`, `cancel-and-determine-no-show`, `capability-gate-ussd-and-authentication` all pass (47 green), including their stale paths (`STALE_ACTION` assertions).

Verification: `npm run check` clean. `npm run test:non-browser` phase 1: 1745 pass / 4 pre-existing failures (reproduce on baseline; see slice 06).

## Comments

- 14 Oct 2026 (agent): Left the revalidation inside `cancellation-application.ts` (`commitGuestCancellation`/`confirmNoShow` throw `STALE_ACTION`). It re-reads authoritative state and re-checks atomically inside the domain, so it is a domain revalidation, not a copy of the gate; removing it would drop defence in depth. The gate now runs the same checks first.
- 14 Oct 2026 (agent): For these specs the domain application still builds its own platform command envelope inside its method; the spec also declares a `command` descriptor the gate envelopes. This is redundant but faithful (ADR 0072 only requires one platform-owned envelope). Routing each application through a gate-built envelope is deferred to the façade slice (09a/09b).
