# ADR draft: domain pack interface and module boundaries

Status: ready-for-human
Type: grilling
Blocked by: none
Requested: 14 Oct 2026
Unlocks: 02, 05
Lane: A: Decisions
PRD: `../PRD.md`

## Why

ADR 0003 promises domain packs on a shared platform, but nothing defines the seam, so shortlet code leaks into apps and platform-core (PRD, Diagnosis 1–7). This ADR fixes the rules every later slice follows.

## What to build

1. Draft `docs/adr/NNNN-define-the-domain-pack-interface-and-module-boundaries.md` with status `proposed`. Use the next free number: 0097 and 0098 are already claimed by guest-stays-and-favourites 02 and weaver-catalogues 03 (`.scratch/WORK-MAP.md`, decision 3), so check `docs/adr/` and the work map first.
2. Record: one public façade per domain (`domains/<d>/src/index.ts`), no imports past it; platform owns the action gate, catalogue registry, payments, accounts, handoff; packs declare prompt section, tools, surfaces, action specs, routes, migrations; hosts are composition roots only.
3. State that the interface is designed against exactly two packs (shortlet, commerce), per ADR 0003's "second domain" condition.
4. Owner reviews and sets `accepted` (or edits).

## Out of scope

- Writing the TypeScript interface (slice 02). Any code change.

## Acceptance criteria

- AC1: The ADR file exists with the rules above and links ADR 0003, 0068, 0072, 0073.
- AC2: It lists what stays domain-owned (transaction models, ledgers, identity assurance) so no shared transaction model is introduced.
- AC3: The owner has accepted it, recorded in `## Comments`.

## Tests

None (document).

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0003-build-an-extensible-concierge-platform.md` | Source of the domain-pack intent and the second-domain gate. |
| `docs/adr/0068-use-ag-ui-and-a2ui-behind-platform-owned-adapters.md` | Platform owns the adapters packs plug into. |
| `docs/adr/0072-route-consequential-actions-through-platform-commands.md` | The shared action gate must keep platform commands. |
| `docs/adr/0073-govern-domain-specific-a2ui-catalogues.md` | Catalogues stay per domain. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Decision slice. DoD items 3 and 5 apply: every listed ADR is read and cited, and nothing is decided that the owner has not confirmed. No production code changes.

## Comments
