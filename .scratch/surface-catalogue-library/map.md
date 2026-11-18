# Map: Surface Catalogue Library

- Decision: ADR 0108 (accepted 18 Nov 2026).
- Analysis and accepted decisions: `analysis.md`.
- Sources: `reports/Surface catalogue library prior art.md`.
- Phase 1 PRD: `PRD.md`.

Work top to bottom. The frontier is the first issue that is open, unblocked and unclaimed. Each issue ends with `npm run check` and its own and affected tests green (AGENTS.md "Test scope"), a rebuilt `apps/local-guest/dist/client.js` when a client file changed, and one commit with explicit paths.

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Decisions, ADR 0108, glossary terms | done 18 Nov 2026 |
| 1 | Skeleton, pure refactor (issues 01–05 below) | ready-for-agent |
| 2 | weaver-catalogues 04–07 built in library format, each with a commerce paper check; organizers deleted; gallery | blocked by phase 1 |
| 3 | Platform tier components; `platform-common/v1` proposed if needed; retire the short ids | blocked by phase 2 and owner approval of any new id |
| 4 | Test-only second-domain fixture pack (mode, cold restore, cross-mode fail closed) | blocked by phase 2 |
| 5 | First real new domain | blocked by an owner decision |

## Phase 1 issues

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 01 | [`packages/surface-kit`: components, manifests and composition](issues/01-surface-kit-components-manifests-composition.md) | task | resolved | none |
| 02 | [Weaver adapters and the ProbeCard alias proof](issues/02-weaver-adapters-and-probe-card.md) | task | resolved | 01 |
| 03 | [Shortlet catalogues as manifests, byte-identical](issues/03-shortlet-catalogues-as-manifests.md) | task | ready-for-agent | 02 |
| 04 | [One registration source; retire the `{ commerce }` flag](issues/04-one-registration-source.md) | task | ready-for-agent | 03 |
| 05 | [Catalogue snapshot gate and change classifier](issues/05-catalogue-snapshot-gate.md) | task | ready-for-agent | 03 |

**Run the issues one at a time.**
- 02 and 04 both rebuild `dist/client.js`.
- Do not run any of them alongside weaver-catalogues 02, which also edits `client.ts` and the builders and rebuilds the client.
- 05 could follow 03 directly, but it reuses 02's ProbeCard and is simplest after 04.

**Gate before phase 2.** After 05, on the final commit, run `npm run check`, `npm run test:workers` and the full `npm test` (in the background with a long timeout). Fix any failure before merging. Merge to main only with the owner's approval.

**Rollback.** Each issue is one commit. Revert in reverse order (05, 04, 03, 02, 01).

## Cross-effort edges

- weaver-catalogues 04, 05, 06 and 07 are amended: they are built in the library format and are blocked by this effort's 05 (comment added to each issue on 18 Nov 2026).
- weaver-catalogues 02 (producer envelopes) is independent of phase 1. It may land before or after, but never at the same time.

## Kickoff prompt

> Implement phase 1 of the Surface Catalogue Library in `.scratch/surface-catalogue-library/`. Read ADR 0108, `PRD.md` and `map.md`, then follow the implementation protocol in `AGENTS.md` for each issue in order, starting at the frontier (issue 01).
>
> - Use the Weaver 0.2.1 published `.d.ts` in `node_modules/@cylayo/weaver-*`. Do not use APIs that exist only on Weaver main.
> - The phase is a pure refactor: no guest-visible change, and byte-identical shortlet catalogue schemas.
> - Do not edit commerce code (`apps/web-agent/src/commerce-*.ts`, `domains/commerce`, commerce assistant files).
> - Do not invent catalogue ids, copy or action names; ask me.

## Context pointers

(Append one line per resolved issue: what landed and where.)
- 01: the Weaver-free library `packages/surface-kit/src` (define, compose, `catalogueIds`, `findGlossaryTerms`), its README, `test/surface-kit*.test.ts`, and the test-only `test/fixtures/surface-kit/probe-card.ts`.
- 02: the Weaver adapters `apps/web-agent/src/catalogues/weaver-catalogues.ts` and `apps/local-guest/src/catalogue-renderers.ts`, the probe manifest `test/fixtures/surface-kit/probe-manifest.ts`, and `test/surface-kit-weaver.test.ts`.
