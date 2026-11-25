# Exploration harness and the two trial checks

Status: resolved
Type: task
Blocked by: none

## Why

The trial (`trial/explore.mts`) found two unowned behaviours in 13 seconds. It is a script. The method needs a small helper and tests. The trial explored 5,460 orders; the rules 01 check plans ten steps, about 20 times as many, so the helper must prune.

## What to build

- `test/helpers/explore.ts` with `exploreOrders({ steps, depth, newWorld, check })` and `exploreFailures({ ports, resumes, newWorld, check })`. Each returns the number explored, the shortest failing sequence, and how often each step succeeded. No dependency, no domain knowledge, no `any`.
- `test/after-booking-exploration.test.ts`: the two trial checks over `CancellationApplication` and `BookingAmendmentManager` with `SqliteBookingStateRepository`, recorded as **known defects**. Each test name starts "KNOWN DEFECT (issue 04)" or "(issue 05)", so nobody reads the expectation as intended. Check A expects the known failing sequence, check B the known unfinished outcomes. Issues 04 and 05 change those expectations.
- Reuse `test/helpers/continuous-occupancy-fixture.ts` and `temporary-database.ts`. Move the booking fixture shared with `integrate-cancellation-application.test.ts` into a helper (AGENTS.md anti-pattern 4).

## Acceptance criteria

- AC1: The helper explores every order up to the depth and reports the shortest failing sequence first. Failure path: a check that never fails reports zero, with the per-step success counts.
- AC2: A step declared required that never succeeds in any order fails the test.
- AC3: The failure explorer fails each port once, in every combination, then resumes the given number of times.
- AC4: The change check finds "request, accept, cancel, commit" on SQLite.
- AC5: The cancellation check reports the seven unfinished combinations and their end state.
- AC6: The helper compares a caller-supplied digest of observable state after each prefix, and does not extend a prefix whose state was already explored at the same or smaller depth, or whose last step was refused and changed nothing. Failure path: a digest that omits a field the check reads makes a seeded defect disappear, and a test shows the helper's own guard against it (digest fields are declared and compared with the fields the check reads).
- AC7: The file finishes in under 30 seconds alone. Wider depth runs only from an explicit script, never from `npm test`.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0058, 0060 | Cancellation and amendment authority | AC4, AC5 |
| 0075 | No credentials or contact data in output | AC1 |

## Notes

Issues 04 and 05 are not started here. Do not fix the behaviour.

## Answer

Built the zero-dependency exploration harness in `test/helpers/explore.ts` (`exploreOrders`, `exploreFailures`), extracted the shared booking fixture, SQLite seeder, and Check A runner into `test/helpers/booking-state-fixture.ts` (shared with `test/integrate-cancellation-application.test.ts`, whose assertions are unchanged), added the explicit CLI runner `scripts/explore-after-booking.ts` (never run by `npm test`), and implemented:
- `test/explore-helper.test.ts` covering AC1, AC2, AC3, and AC6 over seeded buggy and clean fake machines.
- `test/after-booking-exploration.test.ts` recording today's unfixed behaviour on `SqliteBookingStateRepository` as `KNOWN DEFECT (issue 04)` (AC4), `KNOWN DEFECT (issue 05)` (AC5), and deterministic AC7 bounds (`36` explored / `28` pruned for Check A at depth 6; `8` explored for Check B).

Reproduced trial figures (unpruned vs. pruned on `SqliteBookingStateRepository`):
- Check A (unpruned, 4 steps, depth 6): `5,460` orders explored, `403` violations, shortest `request, accept, cancel, commit`, `10,000` kobo charged after cancellation (`60,000` contract total).
- Check A (pruned with digest): `36` orders explored (`28` prefixes pruned), `5` violations, identical shortest `request, accept, cancel, commit`, `10,000` kobo charged after cancellation (`60,000` contract total).
- Check B (3 ports, 3 resumes): `8` failure combinations explored, `7` unfinished after 3 retries.

Measured solo wall-clock timing for `test/after-booking-exploration.test.ts`:
- `~6.8 s` solo in this session (`8.15 s` across all 5 files uncontended); `29–35 s` wall time on the owner's machine with other sessions running (`44.3 s` for AC4 under multi-process contention). AC7 therefore asserts the deterministic explored/pruned counts (`36`/`28` and `8`) rather than wall-clock time so `npm test` cannot flake under load.

## Comments

### ADR compliance
- **ADR 0058** (Standardized cancellation catalogue): Check B drives real `CancellationApplication` + `CancellationNoShowManager` + `SqliteBookingStateRepository` and records today's 7 unfinished combinations without modifying production code or policy rules.
- **ADR 0060** (Versioned booking amendments): Check A drives real `BookingAmendmentManager` over `SqliteBookingStateRepository` and records `request, accept, cancel, commit` charging `10,000` kobo after cancellation without modifying production code.
- **ADR 0072** (Route consequential actions through platform commands): All amendment and cancellation calls in `test/helpers/booking-state-fixture.ts` and `test/after-booking-exploration.test.ts` use `createPlatformCommandEnvelope` and typed synthetic `CommandPrincipal` actors.
- **ADR 0074** (Fail-closed lifecycle): Refused/stale actions leave state unchanged (`STALE_ACTION`); AC6 prunes refused no-op prefixes and records `0` guest actions left on unfinished cancellations.
- **ADR 0075** (Secure and minimize agent-interaction data): Harness reports only step names, counts, failure reasons, and abstract digest fields; all fixtures are synthetic and emit no credentials, payment references, or contact data.

### Verification commands & pass counts
- `Remove-Item Env:LLM_API_KEY -ErrorAction SilentlyContinue; npm run check`: passed (0 errors across root, `apps/cloudflare`, `apps/cloudflare/tsconfig.test.json`, `apps/cloudflare/tsconfig.tooling.json`, and worker bundle guard).
- `Remove-Item Env:LLM_API_KEY -ErrorAction SilentlyContinue; npx tsx --test test/after-booking-exploration.test.ts test/integrate-cancellation-application.test.ts test/amend-material-booking-terms.test.ts test/state-machine-inventory.test.ts test/explore-helper.test.ts`: **20/20 passed, 0 failed** (3 in `after-booking-exploration.test.ts`, 4 in `amend-material-booking-terms.test.ts`, 4 in `explore-helper.test.ts`, 5 in `integrate-cancellation-application.test.ts`, 4 in `state-machine-inventory.test.ts`).
- `Remove-Item Env:LLM_API_KEY -ErrorAction SilentlyContinue; npx tsx scripts/explore-after-booking.ts 7`: passed (`{"depth":7,"prune":true,"explored":36,"pruned":28,"violations":5,"shortestFailure":{"sequence":["request","accept","cancel","commit"],...}}`).
- Earlier solo baseline run of `npx tsx --test test/after-booking-exploration.test.ts`: **3/3 passed** (`6,821 ms` total; owner's machine measured `29–35 s` with other sessions running).

### Definition of Done check
1. **Dedicated named test per AC**: AC1, AC2, AC3, AC6 in `test/explore-helper.test.ts`; AC4, AC5, AC7 in `test/after-booking-exploration.test.ts`.
2. **Failure paths exercised**: AC1 clean machine (0 violations), AC2 blocked required step throws, AC3 invalid resumes throws + resumable vs stuck machines, AC4/AC5 known defects on SQLite, AC6 incomplete digest hides defect + guard throws on omitted `check.reads` / runtime field, AC7 invalid depth throws.
3. **ADRs listed and read**: ADRs 0058, 0060, 0072, 0074, 0075 read and recorded above.
4. **No unused injected dependency**: Verified across `test/helpers/explore.ts` and `test/helpers/booking-state-fixture.ts`.
5. **No invented policy string/rule/constant**: No files under `domains/`, `apps/`, or `packages/` were modified; test data matches `trial/explore.mts` and existing fixtures.
6. **No bearer credential or restricted identity material in logs/output**: Verified (ADR 0075).
7. **`npm run check` and issue/affected tests pass**: Recorded above (0 errors, 20/20 tests passing).
