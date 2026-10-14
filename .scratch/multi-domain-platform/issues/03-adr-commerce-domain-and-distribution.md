# ADR draft: commerce as the second domain, distribution channels, instastore as specification

Status: ready-for-human
Type: grilling
Blocked by: none
Requested: 14 Oct 2026
Unlocks: 04, 18, 28
Lane: A: Decisions
PRD: `../PRD.md`

## Why

ADR 0003 moved commerce out of the launch. Re-admitting it, choosing channels (own app with all verticals; ChatGPT commerce-only) and treating instastore as a spec rather than a system are owner decisions.

## What to build

1. Draft an ADR (next free number, status `proposed`) recording: commerce domain pack in `domains/commerce`; own app hosts all verticals; ChatGPT app is commerce-only because OpenAI allows commerce only for physical goods; instastore rules are ported and instastore is frozen; operator-assisted merchant onboarding first; merchants are verified before their stores appear to the agent (ADR 0001).
2. Decide (or list for the owner) the MVP product identity: one offer per product vs. shared Product.
3. Update `CONTEXT-MAP.md` to say commerce is an active domain once accepted.

## Out of scope

- Payments structure (slice 04). Hosting (slice 05).

## Acceptance criteria

- AC1: The ADR exists with the decisions above and cites the OpenAI guideline URLs from the PRD.
- AC2: `CONTEXT-MAP.md` reflects the decision once accepted.
- AC3: The owner has accepted it, recorded in `## Comments`.

## Tests

None (document).

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0001-merchants-are-sellers-of-record.md` | Merchant remains seller of record. |
| `docs/adr/0003-build-an-extensible-concierge-platform.md` | Domain packs; this is the second domain. |
| `docs/adr/0067-bound-launch-channels-and-support.md` | Adds ChatGPT as a channel for one domain. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Decision slice. DoD items 3 and 5 apply: every listed ADR is read and cited, and nothing is decided that the owner has not confirmed. No production code changes.

## Comments
