# Serve fallback routes; composer without JavaScript

Status: resolved
Type: epic
Findings: F9 (see ../PRD.md)

## What to build

Serve `/stays/search`, `/booking-requests/drafts/:id`, `/conditional-offers/:id` and `/booking-contracts/:id` from the guest server (links built in `apps/web/src/presentation.ts`), or point the fallback links at routes that exist. Give the composer a real `action`/`method` so a turn works without JavaScript and the server renders the transcript.

Verified 25 Sept 2026: `GET /stays/search?city=lagos` returns 404 on :3001.

## Split

This issue is delivered by:
- [06a](06a-conventional-search.md): AC1 (search), AC2
- [06b](06b-conventional-booking-pages.md): AC1 (booking), AC4
- [06c](06c-no-js-composer.md): AC3

## Acceptance criteria (reference)

- AC1: Every conventionalRoute emitted by the guest app returns 200 for its owner.
- AC2: `/stays/search` never reaches the unit-detail handler.
- AC3: With JavaScript disabled, posting the composer produces a server-rendered reply.
- AC4: A route for someone else's draft or offer fails closed.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0080 as modified by 0081 | Material workflows have conventional route parity |
| 0070–0072 | Routes re-authorize and version-check commands |

## Definition of Done

Resolved when every child issue is resolved.
