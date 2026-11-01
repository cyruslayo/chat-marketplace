# 01 · Booking service accepts Short Stays of 1 to 29 nights

Status: ready-for-agent
Type: task
Blocked by: none
Requested: 1 Nov 2026

## What to build

Raise the authoritative Short Stay maximum from 14 to 29 nights (ADR 0023 as amended 1 Nov 2026) in the shortlet domain, with one constant as the only source of the limit.

- `domains/shortlet/src/browse.ts`: `MAX_STAY_NIGHTS = 29`, and update its comment to cite ADR 0023 as amended. Everything that already reads it follows: search (`browse.ts:328`, `:462`), the latest-checkout bound (`:93`), and the draft and submit checks in `booking-request.ts` (`:168`, `:421`).
- `domains/shortlet/src/extended-stay.ts` `assertStayLength`: replace the literal `14` (three places, including both error messages) with `MAX_STAY_NIGHTS`.
- `domains/shortlet/src/booking-amendment.ts`: replace the literal `14` at `:40` and in `requestAmendment` (the `n > 14` check and its message "maximum launch limit of 14 nights") with `MAX_STAY_NIGHTS`. A Short Stay extension may bring the stay to at most 29 nights. Extending a Short Stay to 30 nights or more is not an extension (ADR 0023 amendment): it stays refused.
- Do not add a second constant. Extended Stay limits stay in `ExtendedStayPolicy` (ADR 0092).
- Unchanged: the 90-day Booking Horizon on check-in (ADR 0055), the Short Stay cancellation entries (ADR 0014/0058), the single Revenue Release (ADR 0024, which says "one-to-fourteen-night": confirm `revenue-release.ts` has no night check, and note the result in Comments), and every Extended Stay path.

Update the existing tests that assert 15 to 29 nights are refused; keep their failure-path coverage by moving the boundary to 30 (without a policy) and 0 nights.

## Acceptance criteria

- AC1: A search, quote, Request Draft and Booking Request of 15, 21 and 29 nights succeed as a Short Stay with no Extended Stay policy, and the Stay Quote records the stay type as short.
- AC2: Without an Extended Stay policy (production), 30 nights is refused before search, quoting, inventory blocking or payment, with an error that names the 29-night maximum. 0 nights is still refused.
- AC3: With the demo policy (30 to 180 nights), 29 nights is a Short Stay and 30 nights is an Extended Stay; no length from 1 to 180 is refused at an opted-in unit.
- AC4: A Booking Amendment that brings a Short Stay to 29 nights is accepted under the existing extension rules; one that brings it to 30 nights is refused.
- AC5: No literal `14` remains as a stay-length limit in `domains/shortlet/src` (the 14-day review window in `verified-stay-review.ts` and the cancellation thresholds are not stay-length limits).

## ADR compliance

| ADR | Constraint | Where it bites |
|---|---|---|
| 0023 (amended 1 Nov 2026) | Short Stay 1–29 nights; refuse unsupported lengths before search, quote, blocking or payment; a Short Stay is never extended to 30+ | `MAX_STAY_NIGHTS`, `assertStayLength`, amendment checks (AC1, AC2, AC4) |
| 0092 (amended 1 Nov 2026) | Extended Stay 30–180 nights; limits are policy configuration, not new constants | AC3; no new constant |
| 0055 | 90-day horizon applies to check-in only | Latest-checkout bound grows by 15 days through `MAX_STAY_NIGHTS` |
| 0024 | One booking-level Revenue Release | Confirm no night check; Comments |
| 0105 | Demo policy 30–180 unchanged | AC3 |

## Definition of Done

See `docs/agents/issue-tracker.md`. Record the exact test commands and pass counts in Comments.

## Comments
