# Domain rows: a pack supplies its part of the guest's list

Status: resolved
Type: task
Blocked by: none (D2 accepted 25 Nov 2026)

## Why

`committedWork` lists live stays only and lives in `shortlet-app.ts`. A list across domains needs one contract. Rules: `rules/02-plans-list.md`.

## What to build

- An optional `planRows` on `AssistantDomainPack`, returning closed, validated rows. Unknown keys or values drop that pack's rows (fail closed) with a closed diagnostic.
- A platform composer for groups, order and badge. It reads no pack state.
- The stays implementation, over the same projections the pages use (`guest-stage.ts`, offers, requests, reservations, periods).
- `/api/committed-work` keeps its response, rebuilt on the same source.

## Acceptance criteria

- AC1: Every reachable guest stage appears in exactly one group; a stage without a group fails the type check.
- AC2: `needs_action` is true exactly while the server would accept the action (one instant either side of every deadline).
- AC3: A pack that throws, returns an unknown shape, or is unregistered contributes no rows; other packs' rows remain.
- AC4: Two packs (stays and `fake-domain-pack`) merge in the fixed order with the right badge.
- AC5: No row holds a price, contact, address, identity fact or credential.
- AC6: Every read works after a cold restore.

## ADR compliance

0004, 0005, 0071, 0074, 0075, 0077, 0093, 0099, 0104, 0106, 0107.

| ADR | Constraint | Affected code / AC |
| --- | --- | --- |
| 0004 / 0005 | Authoritative state; Booking Request never shown as Reservation (rules/02 S3) | `shortlet-plan-rows.ts` (`collectStaysPlanEntries`, AC1) |
| 0071 / 0075 | Redacted projections; no price, contact, address, identity fact, or credential | Closed allow-list `validatePlanRow` + `shortletPlanRows` (AC5) |
| 0074 / 0099 | Fail-closed row validation (S6); pack supplies `planRows(scope, now)` while platform owns groups, order, badge | `apps/local-guest/src/assistant/plan-rows.ts` (`composePlanRows`, AC3, AC4) |
| 0077 / 0080 | Shared presentation helpers and pack-owned standard routes | `shortlet-plan-rows.ts` uses `guestRequestStatus`, `guestPaymentStatus`, `conventional*Route` |
| 0093 | Account/principal/claim scoping; sign-out clears visibility; strangers keep identical 404 | `committedWorkScope`, 24-cell decision table + HTTP 404 parity check |
| 0104 / 0107 | Unregistered pack contributes nothing; pack id scopes rows | `composePlanRows` iterates registered packs only (AC3, AC4) |
| 0106 | Every read works after a cold restore | Durable store reads + `trueRestartedDatedApp` cold-restore check (AC6) |

## Answer

Added the domain-agnostic `planRows(scope, now)` contract and platform composer (`apps/local-guest/src/assistant/plan-rows.ts`), wired it onto `AssistantDomainPack` (`apps/local-guest/src/assistant/assistant-platform.ts`), implemented the Stays row collector (`apps/local-guest/src/assistant/shortlet-plan-rows.ts`) over durable booking stores with exhaustive `GuestStage` mapping and lazy deadline evaluation against `now`, wired `shortletPlanRows` into `createShortletAssistantPack` (`apps/local-guest/src/assistant/shortlet-assistant-pack.ts`), exposed `registeredPacks()` on `AssistantRuntime`, and minimally updated `LocalGuestApp` (`apps/local-guest/src/shortlet-app.ts`) to provide `planRows(...)` and rebuild `committedWork(...)` on `collectStaysPlanEntries(...)` while keeping `/api/committed-work` and `guest-server.ts` untouched.

## Comments

- Verified all 6 acceptance criteria, the 24-cell `6 viewers × 4 bookings` decision table, and identical stranger 404 parity in `test/domain-plan-rows.test.ts` (using both Stays and `createFakeShopPack` in `test/helpers/fake-domain-pack.ts`).
- `test/state-machine-inventory.test.ts` passed without requiring changes to `docs/agents/state-machines.md` (no new lifecycle status/stage/state union exported).
- Do-not-edit files (`apps/web/src/shortlet-foundations.css`, `apps/local-guest/src/guest-kit.ts`, `apps/local-guest/src/client.ts`) and `apps/local-guest/src/guest-server.ts` were not edited.
- Commands and counts:
  - `npm run check`: exit 0 (`tsc --noEmit` across root + cloudflare tsconfigs + `node scripts/check-worker-bundle.mjs`)
  - `npx tsx --test test/domain-plan-rows.test.ts test/assistant-pack-contract.test.ts test/guest-new-conversation.test.ts test/state-machine-inventory.test.ts test/guest-navigation.test.ts`: 31/31 passed (8 in `domain-plan-rows.test.ts`, 8 in `assistant-pack-contract.test.ts`, 6 in `guest-new-conversation.test.ts`, 4 in `state-machine-inventory.test.ts`, 5 in `guest-navigation.test.ts`)
  - `npx tsx --test test/guest-account-linking.test.ts`: 30/31 passed (all `committedWork` and account-linking tests pass; 1 pre-existing baseline assertion at line 498 expects `SHORTLET_SCHEMA_VERSION === 5` on a branch where `c167137` added migration v6)
