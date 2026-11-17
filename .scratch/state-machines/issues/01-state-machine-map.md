# 01 State-machine map for agents

Status: ready-for-agent
Type: task
Track: A
Blocked by: none

## What to build

Write `docs/agents/state-machines.md`, with one table row per machine. Columns:
- Machine
- States (quoted)
- Type location (file and symbol)
- Write sites (file and symbol)
- Guard style (allow-list, deny-list, version CAS, SQL CAS or none)
- Lazy-expiry rule
- Governing ADR
- Persisted (yes or no)
- Known gaps (link the issue in `.scratch/state-machines/issues/`)

The file has four sections:
1. **Domain:** `domains/shortlet/src` and `packages/platform-core/src`.
2. **Guest shell and concierge:** `apps/local-guest/src` and `apps/web-agent/src`.
3. **Worker and ops:** `apps/cloudflare/src` and `apps/local-owner`.
4. **Browser client:** `apps/local-guest/src/client.ts` (in-flight flags and `data-*` state attributes).

The seed inventory is `.scratch/state-machines/map.md`. Re-check every location on this branch by symbol name, because line numbers have moved since it was written.

Add one bullet under AGENTS.md "Domain docs & ADR Compliance": "Before changing any `status`/`stage`/`state` field or adding a lifecycle, read `docs/agents/state-machines.md` and update its row in the same commit."

## Acceptance criteria

1. Every machine in `map.md` has a row with every column filled ("none" is a valid value).
2. Every never-written state is flagged with the issue that tracks it:
   - offer `revoked`
   - card session `failed`/`expired`
   - journey `failed`/`expired`
   - check-in support `active`/`human_owned`/`closed`
   - overstay `resolved`
3. The AGENTS.md pointer exists.

## Tests

None; this issue is docs only. Issue 02 adds the ratchet that keeps this file current.

## Comments
