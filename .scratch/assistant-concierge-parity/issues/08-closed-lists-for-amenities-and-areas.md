# Assistant: closed lists for amenities and areas, with the deterministic aliases

Status: ready-for-agent
Type: AFK
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

- `requiredAmenities` is free text (`shortlet-assistant-pack.ts:72`). Discovery keeps only units whose amenities include every string (`domains/shortlet/src/browse.ts:469`), so "power" or "light" instead of `24_7_power_generator` returns zero apartments without saying why. The deterministic path maps words to catalogue ids (`AMENITY_QUESTIONS`, `concierge.ts:447`), including Nigerian "light".
- `normalizeNeighbourhood` (`shortlet-assistant-pack.ts:283`) returns an unknown name unchanged. The deterministic path resolves aliases through `resolveLocationMention` and `SEARCH_AREAS`.
- When the assistant falls back to the deterministic path, `#assistantContextSearch` (`shortlet-app.ts:3212`) does not carry `requiredAmenities` into `discoveryContext`, so the fallback search drops them.

## What to build

- Tool schema enums built from the amenity catalogue and `SEARCH_AREAS` (one source each), so a wrong value cannot be sent.
- The classifier and planner may also pass the guest's word; the pack maps it with the same table as `AMENITY_QUESTIONS` / `resolveLocationMention`. Move that table to one shared place.
- An amenity the catalogue never lists (gym, kitchen, balcony) is acknowledged with the unsupported-preference note (issue 09), not sent as a filter.
- Keep amenities in the context the fallback path reads.

## Acceptance criteria

- [ ] AC1: "Ikoyi with steady light" searches with `24_7_power_generator`.
- [ ] AC2 failure path: an amenity value outside the catalogue is rejected by schema validation as a `tool_denial`, never a zero-result search.
- [ ] AC3: An area alias the deterministic path accepts gives the same city and neighbourhood on the assistant path.
- [ ] AC4 failure path: an unknown area is a `tool_denial` with the area clarification and chips.
- [ ] AC5: After a provider outage fallback, the deterministic search keeps the guest's amenities.
- [ ] AC6: Parity test for the same inputs on both paths.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0106 | Unknown or invalid tool arguments are rejected | AC2, AC4 |
| 0080 | Parity, conventional fallback keeps the request | AC5, AC6 |
| 0099 | Tables in the pack or shortlet domain | Location of the shared table |

## Comments
