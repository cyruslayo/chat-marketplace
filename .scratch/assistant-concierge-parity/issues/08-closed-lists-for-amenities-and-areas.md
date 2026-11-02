# Assistant: closed lists for amenities and areas, with the deterministic aliases

Status: resolved
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
- [x] AC4 failure path: an unknown area is a `tool_denial` with the area clarification and chips.
- [ ] AC5: After a provider outage fallback, the deterministic search keeps the guest's amenities.
- [ ] AC6: Parity test for the same inputs on both paths.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0106 | Unknown or invalid tool arguments are rejected | AC2, AC4 |
| 0080 | Parity, conventional fallback keeps the request | AC5, AC6 |
| 0099 | Tables in the pack or shortlet domain | Location of the shared table |

### Implementation ADR table (agent, 2 Nov 2026)

Discovered sources: no amenity catalogue exists in the domain (inventory amenities are free text, `domains/shortlet/src/inventory-import.ts`). The closed set is the id list of `AMENITY_LABELS` in `apps/web-agent/src/guest-content.ts` (8 ids). The inventory CSV also carries `gym` on one unit, which is not in that list and is never sent as a filter (issue 08 item 4).

| ADR | Constraint | Code path / AC |
|---|---|---|
| 0106 | Unknown or invalid tool arguments are rejected (schema enum on `requiredAmenities` items, `invalid_arguments` before any pack code) | AC2 (`assistant-runtime.ts` malformedArguments), `shortlet-assistant-pack.ts` schema |
| 0106 | Date and stay authority unchanged; an area is a closed check that refuses with a guest sentence (`AssistantGuestRefusalError`, tool_denial) | AC4 (`executeAssistantTool` search_stays) |
| 0106 | Chips are not added here (issue 10) | AC4 wording only |
| 0080 | Deterministic fallback keeps the guest's criteria (amenities carried in `DiscoverySearchContext`) | AC5 (`#assistantContextSearch`, `resolveStayRequestContext`) |
| 0080 | Parity: same structured criteria produce the same search filters on both paths | AC6 |
| 0099 | Alias and catalogue tables live in the shortlet side (`apps/local-guest/src/stay-vocabulary.ts`); the runtime gets only a generic optional `normalizeToolArguments` hook | Location of tables; `assistant-platform.ts`, `assistant-runtime.ts` |
| 0075 | Refusal and clarification text carries no guest value or id | `GUEST_ASSISTANT_COPY.areaClarification` |
| 0077 | Guest copy in `apps/web-agent/src/guest-content.ts` | copy location |

## Comments

### Comments (agent, 2 Nov 2026)

Commands and counts:

- Red before implementation: `env -u LLM_API_KEY npx tsx --test test/assistant-closed-lists.test.ts`, 1 pass / 7 fail of 8. The one pass was AC3 with the three aliases the old map already covered (VI, Lekki, Wuse 2). A bare "Wuse" case was then added to AC3 and failed on the old code (the search sent `neighbourhood: 'Wuse'`).
- Green: `env -u LLM_API_KEY npx tsx --test test/assistant-closed-lists.test.ts`, 8 pass / 0 fail / 8 total.
- Affected files, one run: `env -u LLM_API_KEY npx tsx --test` over test/assistant-closed-lists, assistant-search-unknowns, assistant-tool-argument-validation, assistant-where-chip, assistant-budget-chip, assistant-cold-journey, shortlet-assistant-evals, assistant-scope-controls, assistant-tool-authorization, assistant-runtime-boundary, assistant-unregistered-domain, assistant-pack-registry, browse-one-eligible-unit, integrate-protection-fund-cross-slice, concierge-abuja-discovery, conversational-discovery, guest-budget, guest-real-dates, guest-reflective-replies, guest-must-fix-ux, guest-criteria-strip, guest-chip-continuity, guest-conventional-search, assistant-persistent-continuity, assistant-request-summary, assistant-date-literal-authority (26 files): 269 pass / 0 fail / 269 total.
- Types: `env -u LLM_API_KEY npm run check` exit 0 (run after the implementation and again after the test edits), including the worker bundle guard.
- Not run: the real-Chrome files (the criteria strip screen is unchanged; `criteriaKey` gained an amenity element, which the non-browser criteria tests cover), and the full `npm test` and `npm run test:workers`, which run once per batch (Test scope).

Definition of Done:

1. Every AC has a dedicated test named after it: done (AC1, AC2, AC3, AC4, AC5, AC6 in test/assistant-closed-lists.test.ts; AC2b and the schema test are extra).
2. Failure paths: AC2 asserts the `invalid_arguments` schema rejection (diagnostic `MODEL_SELECTION_FAILURE`) and no search with an amenity; AC4 asserts the area refusal and no search. Done.
3. ADRs cited: 0106, 0080, 0099, 0075, 0077 (table above; code comments at the schema, the hook and the resolver).
4. No unused injected dependency: no new constructor parameter. Done.
5. No invented policy: the closed amenity list is `AMENITY_LABELS` (existing); the alias table and area list moved unchanged; the 16-item cap matches the projection (guest-projection.ts). Gaps noted below. Done.
6. No credentials or guest values in logs: the refusal and clarification text names the closed area list only; the rejected value is not echoed. Done.
7. `npm run check` passes. `npm test` (full) is deferred to the batch pre-merge gate per Test scope, not run per issue.

ADR table (written before code, updated after): see "Implementation ADR table" above. Verified after implementation: 0106 (schema enum on `requiredAmenities`, `invalid_arguments` before pack code; area refusal through `AssistantGuestRefusalError`), 0080 (fallback keeps amenities; AC5/AC6 pass), 0099 (tables in `apps/local-guest/src/stay-vocabulary.ts`, runtime only gets the generic `normalizeToolArguments` hook), 0075 (no values in copy), 0077 (copy in `guest-content.ts`).

Design decisions and deviations (please review):

- Catalogue source: no amenity catalogue existed in the domain code. The closed list is `AMENITY_LABELS` keys, exported as `GUEST_AMENITY_IDS` (guest-content.ts). The inventory CSV has `gym` on one unit; `gym` is not in the catalogue, so it is dropped, never sent.
- Guest words: the pack hook `normalizeToolArguments` (optional on `AssistantDomainPack`, run by the runtime only for an authorised pack tool before the schema check) maps `requiredAmenities` words via the alias table. Unknown words are left as they are, so the enum rejects them as `invalid_arguments`. A word that matches two different amenities (for example "power and wifi") is treated as unknown.
- Search id for an alias: the first id of the alias entry, so "light", "power" and "generator" search `24_7_power_generator`.
- AC4 deviation: the area check is a closed check at execute time, not a schema enum. An enum would reject before the pack could return the guest sentence, so the area stays out of the enum and the neighbourhood description lists the closed names. Unknown area -> `AssistantGuestRefusalError` -> tool_denial with `GUEST_ASSISTANT_COPY.areaClarification` (examples from `SEARCH_AREAS`).
- AC4 chips: NOT added in this commit (issue 10). Added in issue 10: see "AC4 chips delivered" in Comments.
- Area resolution: `resolveSearchNeighbourhood` uses `resolveLocationMention`, so the assistant accepts exactly the words the deterministic path accepts. A city-level word (for example "Wuse", "Lagos") becomes no neighbourhood. A word for another city than the searched one is refused (fail closed; the deterministic path would ask a conflict question instead).
- Inheritance: when the planner omits `requiredAmenities` (or sends null), the search keeps the task's amenities, as it already does for the area and nights. An explicit `[]` clears them.
- Persistence: `#assistantContextFromState` now keeps persisted amenities that are in the catalogue (previously: amenities some unit lists). `parseDiscoverySearchContext` validates the same shape as the projection (at most 16 ids, matching the id pattern).
- Deterministic path: its text extraction still does not read amenity words (unchanged). Its search uses amenities only when they arrive in the discovery context, which is how the fallback gets them.
- The schema enum does not change the `search_stays` `requiredAmenities` from `string[]` to anything else; existing mismatch tests still pass.

## Answer

- `apps/local-guest/src/stay-vocabulary.ts` (new): the shared amenity alias table (`AMENITY_ALIASES`), the location aliases (`STAY_LOCATION_ALIASES`), the closed area list (`SEARCH_AREAS`), `searchAmenityIdsFor` and `normalizeRequiredAmenities`.
- `apps/web-agent/src/guest-content.ts`: `GUEST_AMENITY_IDS` (the catalogue) and `GUEST_ASSISTANT_COPY.areaClarification`.
- `apps/local-guest/src/concierge.ts`: the tables moved out (re-exported `SEARCH_AREAS`); `requiredAmenities` carried in `DiscoverySearchContext`, `StayRequestFilters`, the merge builders and `parseDiscoverySearchContext`.
- `apps/local-guest/src/assistant/shortlet-assistant-pack.ts`: the schema enum on `requiredAmenities.items`; `normalizeToolArguments`; `resolveSearchNeighbourhood` replaces `normalizeNeighbourhood` (closed area check with the guest sentence); amenities inherit when omitted.
- `apps/local-guest/src/assistant/assistant-platform.ts` and `assistant-runtime.ts`: the optional generic pack hook `normalizeToolArguments`, applied to authorised pack tools before validation.
- `apps/local-guest/src/assistant/assistant-tools.ts`: re-exports the renamed resolver and the hook.
- `apps/local-guest/src/shortlet-app.ts`: `#assistantContextFromState` checks the catalogue; `#assistantContextSearch` carries `requiredAmenities` into `thread.discoveryContext` (the fallback); `criteriaKey` includes the amenities.
- `test/assistant-closed-lists.test.ts` (new): AC1 to AC6, an extra gym test, and a schema test.
- Issue 10 (AC4 chips): the area refusal carries `quickRepliesFor("where")` through the pack hook; the AC4 test asserts it.

### Reopened (agent, 2 Nov 2026)

The chips for AC4 were not delivered in commit 1d6fc34 (its Answer lists them as not added). Status set back to `claimed`; the area chips land in issue 10 (`quickRepliesFor("where")` through the clarification hook, `kind: "area"`). AC4 is checked again only when the test `AC4` in `test/assistant-closed-lists.test.ts` asserts the chips.

### AC4 chips delivered (agent, 2 Nov 2026, issue 10)

The chips for an unknown area are `quickRepliesFor("where")`, returned by the runtime's `tool_denial` branch through the pack hook `clarificationQuickReplies` with kind `area` (`shortlet-assistant-pack.ts`, `clarificationChipsFor`). The closed-lists test `AC4: an unknown area is a tool_denial with the area clarification and chips` (extended, not duplicated) now asserts `result.quickReplies` equals `quickRepliesFor("where")`.

- `env -u LLM_API_KEY npx tsx --test test/assistant-closed-lists.test.ts`: 8 pass / 0 fail / 8 total (before the chips: 7 / 1 / 8).
- The refusal is marked `clarification: "area"` (`AssistantGuestRefusalError`), so a Continuous Occupancy refusal gets no area chips.

Status set back to `resolved` by the same commit as issue 10 (one commit for both).
