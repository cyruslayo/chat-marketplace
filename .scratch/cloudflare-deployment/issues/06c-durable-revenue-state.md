# Durable revenue accounting and release state

Status: claimed
Type: task
Blocked by: 02a
Branch: `infra/cf-06c-revenue`
Requested: 2 Oct 2026
Unlocks: 06d

## Why

The owner environment builds `InMemoryRevenueAccountingRepository` (`domains/shortlet/src/revenue-accounting.ts:37`, created at `local-owner-environment.ts:462`) and `RevenueReleaseManager` (`revenue-release.ts:63`, created at :463). Revenue records and release decisions are money evidence. Losing them on restart is a production defect on Node, and it would happen routinely on a Durable Object.

## What to build

1. **Audit first.** Read `revenue-accounting.ts` and `revenue-release.ts`. List every field of instance state: Maps, arrays, counters. For each, record whether it can be re-derived from existing SQLite tables, such as the owner-payable ledger or booking state. Put the list in `## Comments` before writing code.
2. `SqliteRevenueAccountingRepository` implements the same interface as the in-memory one, on a `SqlDatabase`. Use transactions for multi-row writes.
3. For `RevenueReleaseManager`, persist the state that cannot be re-derived, in a table or through the new repository. Keep its public API unchanged.
4. The owner environment uses the SQLite implementations on its shared handle. The in-memory ones stay for tests.
5. **Amounts stay in kobo as integers** (ADR 0078). Store them as `INTEGER`, never as floats.

## Out of scope

- `OperatorEnforcementManager` and owner booking state (06d).
- Changing any revenue or release rule (ADRs 0062, 0083, 0089).

## Acceptance criteria

- AC1: The `## Comments` audit lists every piece of instance state, and either persists it or explains how it is re-derived.
- AC2: Revenue records and release decisions made before a restart are the same after it.
- AC3: A release that fails halfway leaves no partial ledger rows. Failure path: a thrown error inside the release transaction rolls everything back.
- AC4: Amounts round-trip exactly as integers in kobo. A test covers a value above 2^31.
- AC5: The existing revenue and release tests pass against both implementations through a shared contract helper. `npm run check` is clean.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0089 | Collect from guests; pay owners the agreed amount | ledger and release unchanged |
| 0062 / 0083 | Commission and settlement policy | no rule change |
| 0078 | Kobo integers | `INTEGER` columns |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

### Instance-state audit BEFORE implementation (6 Oct 2026)

Read both entire source files, owner composition/sample release and the owner-payable table inventory. There are no hidden counters beyond the fields below.

| Instance field | Re-derivable from existing tables? | Disposition |
| --- | --- | --- |
| Accounting `#releases: Map<reservationId, unknown>` | No: booking state/owner-payable snapshots do not retain these historic release decisions and their captured economics | Persist release snapshot and IDs |
| Accounting `#journals: Map<journalId, LedgerJournal>` | No: owner payouts/cancellations are a distinct ADR 0089 ledger, not these balanced classifications | Persist journal header and integer-kobo lines |
| Accounting `#earned: Map<releaseId, EarnedCommissionRecord>` | No: policy version and earning timestamp cannot be safely inferred from today's booking/config | Persist earned snapshot and integer amount |
| Accounting `#adjustments: Map<id:version, RevenueAdjustmentRecord>` | No: accepted source identity/version/reason and journal are not in the owner-payable tables | Persist immutable adjustment identity and journal |
| Accounting `#failCommit: () => void` | Not business state: test-only fault injector | Keep in memory only |
| Manager `#releases: Map<reservationId, RevenueReleaseRecord>` | No: compatibility API's single-release guard and decision snapshot are not stored elsewhere; production already delegates to accounting | Persist compatibility release state; production re-reads the accounting repository |
| Manager `#adjustments: LedgerAdjustment[]` | No: compatibility API's signed corrections are distinct from production accounting adjustments | Persist compatibility adjustment records |
| Manager `#blockingComplaintQuery` | Injected live authority, not state owned by this manager | Re-compose it; do not persist functions or cache complaint answers |

### ADR plan

| ADR read | Constraint | Acceptance/code path |
| --- | --- | --- |
| 0004 / 0095 | Backend/shared SQL authority, synchronous atomic writes | AC2 / AC3, repository and environment |
| 0078 | Exact integer kobo (including >2^31) | AC4, INTEGER storage and safe-integer validation |
| 0075 / 0070 | IDs/correlation only in general logs, no financial references logged | All paths: no new logging; financial evidence stays in restricted repository |
| 0089 | Current owner agreed-amount/margin ledger remains unchanged | No wiring into or recalculation of owner-payable ledger |
| 0021 / 0024 / 0025 / 0026 / 0062 / 0063 / 0083 | Superseded settlement policies are NOT restored as launch rules; only retain the existing historical/compatibility implementation and evidence | AC2 / AC5, parity tests, existing sample projection only |
| 0092 | No new Extended Stay periods or settlement rules | Scope boundary; existing snapshot identities unchanged |

The issue references commission ADRs now superseded by ADR 0089. This is persistence-only: do not change arithmetic, expose new policy, or claim the legacy sample proves current owner settlements. AC5 will share the existing revenue/release scenarios across the in-memory and SQL adapters. Each AC gets its own dedicated test before implementation. Full-suite resolution remains gated; no Wave 3 work.

### Implementation review (full-suite gate pending)

- AC1–AC5 each have a dedicated test in `test/sqlite-revenue-state.test.ts`. The first run failed on the missing implementation (`C:/AI2026/cf-06c-red.log`). Existing commission/release and application suites now register unchanged economic scenarios for both adapters through `test/helpers/revenue-contract.ts`; identity assertions compare snapshot values, not JavaScript object references.
- AC2 exercises real owner-environment restart, production release/journal/earned/adjustment reconstruction, adjustment replay and the compatibility manager's durable duplicate guard and signed correction. AC3's trigger aborts earned-commission insertion after release/journal/lines have been written and verifies all four tables empty after rollback. AC4 covers 3,000,000,001 kobo in release/ledger INTEGER columns and rejects fractional corrections.
- Re-checked every ADR-table constraint: owner-payable/cancellation ledger and financial arithmetic are unchanged; release evidence is shared-handle durable, multi-row writes are synchronous atomic transactions, and all new monetary columns use INTEGER with safe-integer input validation. No new logs, bearer credentials, thresholds or launch settlement policies.
- All constructor dependencies are used; stores borrow their handle without connection opens/pragmas/close ownership. The optional compatibility state store is used for reads and writes, never a second production financial truth.
- `npm run check`, **47 focused tests**, **14 workerd tests** and `git diff --check` pass. Evidence: `C:/AI2026/cf-06c-{check,focused,workers}.log`. LSP probe was inconclusive on three paths and reported only existing generic class-size/conditional-spread hints; compiler checks are the typecheck evidence.
- DoD 1–6 reviewed above; DoD 7 awaits the serialized stable full suite. Do not resolve or integrate this slice based only on focused results.
