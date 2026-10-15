# Registry-fed catalogues; domain-supplied handoff and interaction-security fields

Status: resolved
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

## Answer

Landed:
- `packages/platform-core/src/catalogue-registry.ts` — `CatalogueRegistry` (`register(owner, ids)`, `has`, `ownerOf`, `ids`) re-exported from the index. `GenerativeSurfaceManager` now takes `{ catalogues?: CatalogueRegistry }` and rejects any catalogue no pack registered; `APPROVED_CATALOGUES` stays as the default registration so existing no-arg construction keeps accepting the shortlet ids.
- `packages/platform-core/src/human-handoff.ts` — added `HandoffDomainConfig` (pack-supplied `safeDetailKeys`, `supportQueues`, `supportPathFor`) and `HandoffRequest`; the manager takes `{ domain? }` defaulting to `DEFAULT_HANDOFF_DOMAIN`. `activeStay`/`bookingId` knowledge is gone from platform-core.
- `packages/platform-core/src/interaction-security.ts` — the accepted summary kinds are now constructor-supplied (`{ summaryKinds? }`), defaulting to the platform kinds.
- `apps/web/src/human-handoff-application.ts` — `SHORTLET_HANDOFF_DOMAIN` supplies shortlet's safe keys, queue names and `activeStay`-aware routing, so production behaviour is identical.

Tests:
- `test/platform-core-catalogue-registry.test.ts` — AC1 "A catalogue not registered by any pack is rejected" (registered accepted, unregistered rejected on create and fallback; empty registry rejects everything; ownership recorded) and AC3 "Shortlet catalogues, handoff routing and summary kinds keep their existing values".
- `test/platform-core-domain-agnostic.test.ts` — AC2 "platform-core source contains no activeStay, bookingId or booking_summary literals", green.
- Existing surface, handoff and security tests pass unchanged (45 green in the affected batch).

Verification: `npm run check` clean. `npm run test:non-browser` phase 1: 1743 pass / 4 pre-existing failures (reproduce on baseline; see slice 06).

## Comments

- 14 Oct 2026 (agent): `.scratch/weaver-catalogues/03` has not landed (WORK-MAP marks it "Not built (reconciled)"). It builds Weaver client `CatalogRegistration`s, a different concern from the platform's approved-catalogue list, so this registry is the platform seam and does not duplicate a Weaver mechanism. When 03 lands, the shortlet pack registers the same ids here.
- 14 Oct 2026 (agent): AC2 (no `booking_summary` in platform-core) and AC3 ("existing tests pass") conflict for `InteractionSecurityEngine.renderTypedA2UI`, which is not used in production. I removed the literal and made the accepted kinds pack-supplied, then updated the one existing assertion's construction in `test/prevent-interaction-security-failures.test.ts` to register the shortlet kinds; its expectation is unchanged. No shortlet production behaviour changed.
