# Isolate external context and rejected instructions

Status: ready-for-agent
Blocked by: 03

## What to build

Implement control 4 and ADR 0106 through pack-owned public-fact projections and platform history construction.
Minimize what listing/tool data reaches the model; preserve source/trust labels for remaining external strings.
Never promote external narrative into system instructions, tool schemas, scope policy, reply copy, or permission lists.
Keep credentials, private identity/payment material, raw exception text, and hidden internal identifiers out of model-visible context and diagnostics.
Quarantine rejected guest/model content from later model history and trusted summaries without erasing committed domain audit evidence.
Bound retained model context through configured engineering limits and safe summaries of canonical state, rather than model-written authority.
Keep Node and Cloudflare persistence behavior consistent.

## Acceptance criteria

- [ ] AC1: Injections in titles, descriptions, amenities, and tool-result strings cannot change tools, instructions, authorization, reply facts, URLs, or actions.
- [ ] AC2: Classifiers receive only current input plus minimal canonical task facts; model context excludes unnecessary narrative and restricted fields.
- [ ] AC3: Rejected turns cannot poison later model requests after a normal turn, task switch, persistence round trip, or cold start.
- [ ] AC4: Safe tool projections still provide enough facts for discovery, comparison, pricing, status, and booking preparation.
- [ ] AC5: Diagnostics and artifacts contain only permitted metadata, with no prompts, replies, keys, or restricted identity/payment material.

## ADR compliance

Use PRD's ADR map and ADR 0106. Test actual model requests and application persistence boundaries, rather than isolated sanitizers alone.

## Comments

Record commands, pass counts, commit, and Definition of Done evidence.
