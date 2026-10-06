# Durable reserve-payout state (follow-up to 06c and 06d)

Status: resolved
Type: task
Blocked by: 06c, 06d
Branch: `infra/cloudflare-deployment`
Requested: 6 Oct 2026
Unlocks: 15

## Why

06d found that `ReservePayoutManager` (`domains/shortlet/src/reserve-payout-trust.ts`) keeps three pieces of instance state that neither 06c nor 06d persisted. A Durable Object restart or eviction (ADR 0095) would lose them. Admin holds feed trust-tier and payout decisions, so losing them silently lifts a hold. Losing the idempotency map lets a retried command run twice.

## What to build

- Audit the manager field by field in `## Comments` (below), as 06c and 06d did.
- An optional `store` on `ReservePayoutManagerOptions`: in-memory default, `SqliteReservePayoutStateStore` on the shared `SqlDatabase` handle. Transactions go through `database.transaction`, with no await inside.
- Wire the SQLite store in `apps/local-owner/src/local-owner-environment.ts` where the manager is created.
- A restart test patterned on `test/operator-process-restart.test.ts`.

## Out of scope

- Changing payout, hold or tier policy. No new policy values.
- ADR 0089 says there are no rolling reserves or payout plans at launch, so tranches are not expected in the pilot. The manager and its tests still exist, so the state is made safe rather than removed.

## Acceptance criteria

- AC1: Comments audit lists every piece of instance state and persists it or explains re-derivation.
- AC2: An admin payout hold applied before a restart is still in force after it. Failure path: the operator's trust tier is still forced to standard by the hold, and removing the hold after the restart lifts it.
- AC3: A command replayed after a restart returns the original result without running again, and an idempotency key reused for a different command is still refused.
- AC4: Reserve tranches survive a restart, and a release is atomic with its ledger movement. Failure path: a tranche that fails to save leaves no ledger adjustment, and a released tranche cannot be released again after a restart.
- AC5: No credential or contact material in stored records (ADR 0075).
- AC6: `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0064 | Active enforcement overrides trust tier for new settlement decisions | admin holds persisted, read by `evaluateOperatorTrustTier` and `calculatePayoutPlanAndReserve` |
| 0083 (superseded by 0089) | Admin hold blocks improved terms; tranche release needs maturity, no hold, balanced ledger | tranche release transaction; the code's existing behaviour is unchanged |
| 0089 | No rolling reserves or payout plans at launch | tranches are expected empty in the pilot; persisted for correctness, not extended |
| 0004 | Backend owns authoritative state; no instance-only state | all three maps move to the store |
| 0095 | Durable Object SQL, synchronous transactions, no network I/O inside | `database.transaction`, synchronous callbacks |
| 0075 | No credentials in stored records | idempotency fingerprints hold command name, principal id, tenant and payload only |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

Pre-code audit. `ReservePayoutManager` instance state, field by field:

- `#tranches` (Map by trancheId, `ReserveTranche`): persisted. Status (`held`, `released`, `forfeited_for_liability`) guards against a duplicate release, so it cannot be re-derived from the ledger alone without losing the maturity date and tranche identity.
- `#adminHolds` (Map by operatorId, `AdminHoldRecord`): persisted. It is a human enforcement decision, not derivable from anything else. It feeds `evaluateOperatorTrustTier` and `calculatePayoutPlanAndReserve`.
- `#executedCommands` (Map by idempotency key, command name, fingerprint and result): persisted. A retried command after a restart would otherwise run a second time.
- `#reliabilityAuthority`, `#enforcementAuthority`, `#scopeAuthority`, `#accountingRepository`, `#clock`: injected collaborators, not state; nothing to persist.
- The new `#store` is the injected state store.

Multi-step writes run in one `transaction`: apply or remove a hold writes the hold and the command result together; a tranche release writes the ledger adjustment and the tranche status together; the tranche command also records its result in the same scope.

## Answer

Resolved 6 Oct 2026. `ReservePayoutManager` keeps its API and takes an optional `store`; the default is in memory and the owner environment passes `SqliteReservePayoutStateStore` on the shared handle. Admin holds, tranches and executed commands now survive a restart.

- AC1: `test/reserve-payout-restart.test.ts` checks the audit above lists every field.
- AC2: a hold applied before a restart still forces the tier to standard afterwards, and removing it after the restart lifts it.
- AC3: a command replayed after a restart (with the clock moved on) returns the original record; a reused key with a different payload is still refused.
- AC4: a held tranche survives a restart; a release survives one and cannot be repeated (the retry returns the stored result, a new key is refused as a duplicate, and no second ledger movement is posted). A tranche that fails to save rolls back its ledger adjustment and its idempotency record.
- AC5: stored records contain no credential or contact material (ADR 0075).
- AC6: `npm run check` clean; full `npm test` 1365 of 1365 non-browser and 165 of 166 browser passed, the one skip being the existing opt-in foundations check.
- Mutation check: removing the store from the owner environment makes the four restart tests fail.
- ADRs: 0004 (no instance-only state), 0064 and 0083 (admin hold overrides tier; unchanged policy), 0089 (no reserves at launch, so tranches are expected empty in the pilot), 0095 (synchronous `database.transaction`, no I/O inside), 0075.
