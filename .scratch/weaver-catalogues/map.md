# Map: Weaver 0.2.1 and the `shortlet-*` catalogues

PRD: `PRD.md`

Work top to bottom. The frontier is the first issue that is open, unblocked and unclaimed. Each issue ends with `npm run check` and `npm test` green, a rebuilt and committed `apps/local-guest/dist/*.js` when a client file changed, and a commit.

| # | Issue | Type | Blocked by |
| --- | --- | --- | --- |
| 01 | [Move to `@cylayo/weaver-*` 0.2.1 from npm](issues/01-weaver-0-2-1-from-npm.md) | task | none |
| 02 | [Build A2UI envelopes with `createA2UIV091Producer`](issues/02-producer-envelopes.md) | task | 01 |
| 03 | [ADR 0102, `shortlet-*` catalogue definitions and the runtime factory](issues/03-catalogues-and-runtime.md) | task | 01 |
| 04 | [`shortlet-booking/v1`: StayTicket and PriceBreakdown](issues/04-booking-catalogue.md) | task | 02, 03 |
| 05 | [Unit detail on `shortlet-discovery/v1`](issues/05-unit-detail-catalogue.md) | task | 03 |
| 06 | [Discovery cards on `shortlet-discovery/v1`](issues/06-discovery-cards-catalogue.md) | task | 03 |
| 07 | [Comparison on `shortlet-discovery/v1`](issues/07-comparison-catalogue.md) | task | 06 |
| 08 | [Clean-up, retirement guard and capture sweep](issues/08-cleanup-and-captures.md) | task | 04, 05, 06, 07 |

## Implementation waves

A wave is the set of issues that are unblocked once every earlier wave has resolved.

| Wave | Issues | What it delivers | Gate before the next wave |
| --- | --- | --- | --- |
| 1 | 01 | 0.2.1 from npm, `@weaver/*` imports renamed, vendor removed. No behaviour change. | Full `npm test` green with unchanged expectations, which is the replay and parity gate (ADR 0079), and a clean `npm ci`. |
| 2 | 02, 03 | Producer-built envelopes with byte-for-byte equal output. ADR 0102, the two catalogue registrations, `createShortletWebRuntime`, and validation and stale-client tests. No surface uses the new catalogues yet. | Every existing builder output still validates. The client runs on `createShortletWebRuntime` with no visible change. |
| 3 | 04, 05, 06 | Booking ticket and breakdown, unit detail, and discovery cards move to typed components. `organizeBookingTicket`, `organizeUnitDetail` and `decorateDiscoveryCards` are deleted. | Each chat-to-page parity Chromium suite is green with unchanged expectations, plus captures at 320, 390, 768 and 1280. |
| 4 | 07 | Comparison moves to `StayComparison`, and `decorateComparison` is deleted. | Compare suites green, plus captures. |
| 5 | 08 | Dead helpers removed, a retirement guard test, docs updated, and the full light and dark capture sweep. | The effort is complete. |

**Run issues one at a time, even within a wave.**
- 02 and 03 touch different files, but 03 changes the client's runtime set-up.
- 04, 05 and 06 all edit `apps/local-guest/src/client.ts` and the shared `shortlet-renderers.ts`, and rebuild the committed `dist/client.js`.
- Every issue runs the roughly 12-minute browser phase of `npm test`, and only one browser suite or capture sweep may run at a time (AGENTS.md).

The waves show what is independent in scope, so the order inside a wave is free. Suggested order: 02, 03, 04, 05, 06.

**Rollback.** Each issue is one self-contained commit, so `git revert` restores the previous rendering path (ADR 0079). Revert wave 3 issues before 03, and revert 01 last.

## Kickoff prompt

> Implement the Weaver catalogue effort in `.scratch/weaver-catalogues/`. Read `PRD.md`, then `map.md`, and follow the implementation protocol in `AGENTS.md` for each issue in order, starting at the frontier (issue 01).
>
> - The Weaver 0.2.1 API reference is the `v0.2.1` tag of <https://github.com/cyruslayo/weaver> and the published `.d.ts` in `node_modules/@cylayo/weaver-*`. Don't use APIs that exist only on Weaver main, such as `defineCatalog`.
> - For each guest UI issue, follow `.scratch/guest-ui-consistency/`: use the kit, run the walkthrough, and capture at 320, 390, 768 and 1280.
> - Don't invent copy, amounts or catalogue identifiers beyond ADR 0102; ask me.

## Context pointers

(Append one line per resolved issue: what landed and where.)

- 03 resolved in `b0c1454`: accepted ADR 0102, centralized discovery/booking registrations, shared guest runtime, strict outbound message validation, rebuilt client, and stale-runtime/fallback coverage. Full `npm run check`, `npm run build`, focused tests (6 passed), complete `NODE_ENV=test npm test` (1809 unit and 177 browser passed; 2 skipped), and 21 serial capture groups passed; no overflow (only hidden 1×1 native radios, with normal labels). Issue evidence: [03](issues/03-catalogues-and-runtime.md).
- 01 resolved: migration landed in `6503849`; the safe text/route fallback integration is `38e4829`; the scroll-readiness regression is `7276cc3`. AC1–AC6, ADR mapping and DoD evidence are complete in [01](issues/01-weaver-0-2-1-from-npm.md), including a final full-suite pass (phase 1: 1817 passed; phase 2: 177 passed, 2 skipped). The 320px trace confirmed the test read before the existing scheduled scroll frame; its assertion now waits for the same fully-visible state. Historical migration/validation notes remain dated and qualified. **Current frontier after 01 resolution: 02 — Build A2UI envelopes with `createA2UIV091Producer`.**
