# 01 Entry and search continuity

Status: resolved
Type: task
Blocked by: none

## What to build

Keep the landing message and current thread across chat and conventional routes. Carry the selected trip and current authoritative All-In Stay Total from results to Unit detail. Give zero results accurate copy and direct criteria repair. Do not replace a current quote with an indicative nightly price.

## Acceptance criteria

- AC1: A first landing message opens the correct conversation once, including on retry and with an existing conversation.
- AC2: A selected search result opens Unit detail with the same current dates, guests, All-In Stay Total, and separate deposit in chat and on the conventional route; stale or incomplete quote input fails closed.
- AC3: A zero-result reply says no stays match, preserves guest criteria, and provides direct edit controls in both channels; no result action appears.
- AC4: Back from Unit detail returns to the current results and conversation without an empty thread or lost criteria.

## ADR map

0005: open dates still need Operator confirmation. 0015/0016: full price and deposit stay distinct. 0074: stale action fails closed. 0077: both channels use canonical facts. 0078: phone accessibility and WAT. 0080: conventional search and detail remain usable. 0106: cold restore keeps surface identity and guest-authored criteria. Read any other intersecting ADRs before code.

## Tests and evidence

Write one named failing test per AC, covering the named failure paths. Check the landing-to-thread route, conventional search and Unit detail, chat discovery, cold restore, and zero results. Run `npm run check` and only affected files, with a real-Chrome file alone. Capture changed screens at 320, 390, 768, and 1280, light and dark. Record exact commands and pass counts below. Complete all items in `docs/agents/issue-tracker.md` before resolve.

## Comments

- ADR review: 0004 keeps the server authoritative (AC2–3); 0005 retains Request to Book (AC2); 0015 requires dated All-In Stay Total (AC2); 0016 separates the refundable deposit (AC2); 0023 and 0055 constrain dated search inputs (AC2); 0066 governs discovery ranking (no ranking changes); 0074 rejects stale actions (AC2); 0077 requires canonical facts across channels (AC2–3); 0078 requires reflow and usable targets (all screens); 0080 keeps conventional workflows (AC1–4); 0106 keeps thread and guest criteria continuity (AC1–2, AC4).
- Implementation: discovery routes carry the selected criteria. Detail recomputes the current quote from the server discovery projection. Incomplete or stale quote inputs return an error. Thread identity stays at the web route boundary. Unknown thread state returns `INVALID_THREAD` with 404 instead of an empty thread.
- Named acceptance tests: AC1 in `test/landing-handoff.test.ts`; AC2, AC3, and AC4 in `test/guest-conventional-search.test.ts`. AC2 covers incomplete and stale quote criteria. AC4 covers current thread identity and unknown-thread rejection.
- Type and focused checks passed: `npm run check`; `npx tsx --test test/guest-conventional-search.test.ts test/landing-handoff.test.ts test/guest-discovery-consistency.test.ts test/guest-unit-detail-consistency.test.ts test/assistant-discovery-view.test.ts test/guest-conventional-booking-pages.test.ts` (27 passed, 0 failed).
- Real Chrome checks passed, one file at a time: `npx tsx --test test/guest-discovery-consistency-chromium.test.ts` (8 passed, 0 failed); `npx tsx --test test/guest-unit-detail-consistency-chromium.test.ts` (3 passed, 0 failed). These checks cover 320, 390, and 1280 pixel layouts. Separate screenshots at every requested viewport and theme were not captured.
- Definition of Done review: dedicated named tests cover all four acceptance criteria and their stated failure paths. Relevant ADRs are listed above. No constructor dependency was added. No policy rule or business threshold was added. No bearer credential or restricted identity data was logged. `npm test` remains for the batch pre-merge gate.

## Answer

Issue 01 implementation is complete. Context: conventional search and detail now use the same server quote and preserve criteria and thread identity through the route. See this entry's Comments for focused evidence.
