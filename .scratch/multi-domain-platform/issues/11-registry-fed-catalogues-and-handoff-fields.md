# Registry-fed catalogues; domain-supplied handoff and interaction-security fields

Status: ready-for-agent
Type: task
Blocked by: 02
Requested: 14 Oct 2026
Unlocks: 12
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

`packages/platform-core/src/surface.ts` hardcodes `APPROVED_CATALOGUES`; `human-handoff.ts` and `interaction-security.ts` know stay and booking fields (PRD, Diagnosis 6).

## What to build

1. `GenerativeSurfaceManager` takes the approved catalogue list from a registry populated by packs; unknown catalogues still throw (fail closed).
2. `human-handoff.ts`: safe-field allow-list and queue names supplied by the pack; remove `activeStay`/`bookingId` knowledge from platform-core.
3. `interaction-security.ts`: domain summary types supplied by the pack (replaces hardcoded `booking_summary`).
4. Shortlet registers its existing values so behaviour is identical.

**Coordinate with `.scratch/weaver-catalogues/`.** Issue 03 there builds the `shortlet-*` catalogue definitions and the Weaver runtime factory. If it has landed, the registry here feeds that factory; if it is in flight, agree the registration shape in `## Comments` of both issues before coding. Do not build a second catalogue mechanism.

## Out of scope

- Agent registry (12). New commerce catalogues (23).

## Acceptance criteria

- AC1: A catalogue not registered by any pack is rejected.
- AC2: Platform-core source contains no `activeStay`, `bookingId` or `booking_summary` literals.
- AC3: Shortlet surfaces, handoff and security checks behave as before (existing tests pass).

## Tests

New platform-core tests for registry rejection; existing tests.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0073-govern-domain-specific-a2ui-catalogues.md` | Catalogue identifiers stay frozen per domain. |
| `docs/adr/0074-give-generative-surfaces-a-fail-closed-lifecycle.md` | Unknown catalogue fails closed. |
| `docs/adr/0076-suspend-automation-during-human-takeover.md` | Handoff semantics unchanged. |
| `docs/adr/0075-secure-and-minimize-agent-interaction-data.md` | Safe-field allow-list still minimizes data. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
