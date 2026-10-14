# Platform Interactions gate and ActionSpec; convert card-payment and bank-transfer actions

Status: ready-for-agent
Type: task
Blocked by: 02
Requested: 14 Oct 2026
Unlocks: 08a, 08b, 14a
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

The action gate is re-implemented in 22 files (PRD, Diagnosis 3). Pull it down into one platform module so packs only declare what is specific to them.

## What to build

1. Add `packages/platform-core/src/interactions.ts` with the `ActionSpec` shape chosen in slice 02 and one `resolveAction(event, specs, principal)` that performs: context shape and allow-list, artifact kind and schema version, artifact/entity match, stale projection, action authorized, platform command envelope (`createPlatformCommandEnvelope`), and returns the existing rejection codes.
2. Convert `apps/web/src/card-payment-actions.ts` and `apps/web/src/bank-transfer-actions.ts` to `ActionSpec`s that use it; keep their exported event names and result types so callers in `apps/local-guest/src/guest-server.ts` do not change.
3. Export from `packages/platform-core/src/index.ts`.

## Out of scope

- Other `*-actions.ts` files (08a, 08b). Changing rejection messages shown to guests.

## Acceptance criteria

- AC1: A stale, mismatched, malformed or unauthorized action is rejected by the platform gate with the same code as before, for any registered spec.
- AC2: Card payment initialize and verify-return events behave exactly as before (existing tests pass unchanged).
- AC3: Bank transfer actions behave exactly as before.
- AC4: No gate logic (context allow-list, stale check) remains in the two converted files.

## Tests

New `test/platform-interactions-gate.test.ts` with one test per rejection path; existing card and bank-transfer tests unchanged.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0072-route-consequential-actions-through-platform-commands.md` | The gate creates the platform command. |
| `docs/adr/0074-give-generative-surfaces-a-fail-closed-lifecycle.md` | Stale and expired actions fail closed. |
| `docs/adr/0075-secure-and-minimize-agent-interaction-data.md` | No credentials in rejection logs. |
| `docs/adr/0046-permit-only-one-live-payment-attempt.md` | Card payment semantics must not change. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
