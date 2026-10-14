# Design it twice: walk shortlet and commerce flows through DomainPack and ActionSpec

Status: ready-for-agent
Type: research
Blocked by: 01
Requested: 14 Oct 2026
Unlocks: 07, 11
Lane: A: Decisions
PRD: `../PRD.md`

## Why

Ousterhout's 'design it twice': an interface shaped by one user is special-purpose. Walk both real domains through the sketch in the PRD before code depends on it.

## What to build

1. Take two shortlet flows (request-to-book → offer → card payment; check-in support → human handoff) and two commerce flows (search → store cart → checkout; order tracking) and express each as `DomainPack` tools, surfaces and `ActionSpec`s.
2. Read the 15 `apps/web/src/*-actions.ts` files and list every check the action gate performs; confirm `ActionSpec` can express each one (context keys, optional fields, stale rules, authorization).
3. Write two alternative interface shapes (e.g. declarative `ActionSpec` vs. a per-pack `handleAction` function) and compare depth: interface size vs. hidden work.
4. Write the chosen interface as a TypeScript sketch in `## Answer` (not in `src/`).

## Out of scope

- Implementation. Changing any `src/` file.

## Acceptance criteria

- AC1: `## Answer` maps all four flows onto the chosen interface with no escape hatch.
- AC2: `## Answer` lists every gate check found in the 15 `*-actions.ts` files and how `ActionSpec` expresses it.
- AC3: Both alternatives are compared and the choice is justified in terms of interface size vs. hidden functionality.
- AC4: Open questions (e.g. one Product shared across stores or not) are listed for the owner.

## Tests

None (design).

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0072-route-consequential-actions-through-platform-commands.md` | Every action still becomes a platform command. |
| `docs/adr/0074-give-generative-surfaces-a-fail-closed-lifecycle.md` | Stale and expired surfaces must fail closed in the shared gate. |
| `docs/adr/0080-retain-deterministic-parity-for-critical-workflows.md` | Packs must support the deterministic concierge path too. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Research/design slice. DoD items 3 and 5 apply. No production code changes; the evidence and conclusions go in `## Answer`.

## Comments
