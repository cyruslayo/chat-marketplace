# Domain rows: a pack supplies its part of the guest's list

Status: ready-for-agent
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

## Comments
