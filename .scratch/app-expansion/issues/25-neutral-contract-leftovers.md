# Remove stay-only assumptions from the pack contract

Status: ready-for-agent
Type: task
Blocked by: 10 (D2 accepted 25 Nov 2026). Serial with any change to `assistant-platform.ts`

## Known leftovers on main

1. `discoverySurface` and `unitDetailSurface` are required on every pack.
2. `CONCIERGE_INTENTS` is one shared list of booking intents.
3. `GUEST_MODE_SUGGESTION.message` always says "Your stay details are saved", which is wrong when leaving another domain.
4. `JOURNEY_STEPS` is the stays journey in shared code.
5. `dateClarification` and `stayDetailsClarification` are stay questions on the shared interface.

## What to build

Behaviour-preserving moves, one commit each, with stays output byte-identical. Design against stays and the parked commerce pack on paper (ADR 0099 decision 7). Do not edit commerce.

## Acceptance criteria

- AC1: A pack with no discovery or detail surface registers and answers.
- AC2: The stays prompt, tools, replies and surfaces are unchanged (recorded hashes, as 03a did).
- AC3: The suggestion names the domain being left. New copy waits for the owner.
- AC4: A pack's own journey words render; an unknown step renders nothing.

## ADR compliance

0099, 0104, 0106, 0107, 0108.

## Comments
