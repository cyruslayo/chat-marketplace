# Platform Interactions gate and ActionSpec; convert card-payment and bank-transfer actions

Status: resolved
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

## Answer

Landed:
- `packages/platform-core/src/interactions.ts` — the one platform gate. `ActionSpec<Context, Artifact, Payload>` declares only the action-specific parts (artifact kind/schema/load, context schema, entity `crossMatch`, the `expect` versions the gate compares, `isAuthorized`, the command descriptor and the domain `run`); `resolveAction`/`resolveActionAsync` perform G1–G13 generically and return the existing rejection codes. Re-exported from `packages/platform-core/src/index.ts`.
- `apps/web/src/card-payment-actions.ts` and `apps/web/src/bank-transfer-actions.ts` — now declare an `ActionSpec` and delegate to the gate; no `contextOf`, no hand-rolled allow-list, no stale/projection comparison. Exported event names and result types are unchanged, so `apps/local-guest/src/guest-server.ts` callers are untouched.
- `CardPaymentApplication.initializeCheckoutFromCommand` / `BankTransferPaymentApplication.initializeTransferFromCommand` accept the gate-built envelope (the existing `initializeCheckout`/`initializeTransfer` delegate to them).

Design note (per ADR 0099 rule 3 and slice 08b AC3): staleness is declarative. A spec lists `expect` `{ expected(context), actual(artifact) }` pairs; the gate owns the comparison and the `STALE_ACTION` rejection, so no `STALE_ACTION` gate implementation remains outside `packages/platform-core`.

Tests:
- `test/platform-interactions-gate.test.ts` — one named test per rejection path: UNSUPPORTED_ACTION, INVALID_CONTEXT (missing key / unknown key / wrong type), INVALID_ARTIFACT (load throws / superseded schema), ARTIFACT_MISMATCH, ENTITY_MISMATCH, STALE_ACTION, ACTION_NOT_AUTHORIZED (not advertised / run throws), plus a success path asserting the gate-built envelope and by-name resolution. 14 green.
- `test/integrate-security-deposit-payment.test.ts` — unchanged, green (card initialize and verify-return behave as before).

Verification: `npm run check` clean. `npm run test:non-browser` phase 1: 1743 pass / 4 pre-existing failures (reproduce on baseline; see slice 06).

## Comments
