# 01 · Booking service accepts Short Stays of 1 to 29 nights

Status: resolved
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

### 1 Nov 2026, implementation (branch feat/short-stays-and-extended-production)

**Files changed**
- `domains/shortlet/src/browse.ts`: `MAX_STAY_NIGHTS` 14 to 29, comment cites ADR 0023 as amended 1 Nov 2026. The 104-day comment on `DEMO_TRUST_EXPIRES_ON` now reads 119 days (90 + 29); no code reads that figure.
- `domains/shortlet/src/extended-stay.ts`: `assertStayLength` uses `MAX_STAY_NIGHTS` in all three places, including both messages. Imports the constant from `./browse.js`. The import cycle (browse imports extended-stay) is safe: the constant is read only inside functions; both load orders were checked.
- `domains/shortlet/src/booking-amendment.ts`: `#validate` and `requestAmendment` use `MAX_STAY_NIGHTS`; the message is now "Stay length exceeds the maximum Short Stay limit of 29 nights".
- `test/short-stay-29-nights.test.ts` (new): one test per AC1 to AC5.
- Boundary updates only (15 to 29 nights refused becomes 30 refused; exact 14 allowed becomes exact 29): `test/browse-one-eligible-unit.test.ts`, `test/guest-real-dates.test.ts`, `test/submit-and-resolve-timed-booking-request.test.ts`, `test/demo-extended-stay.test.ts`, `test/demo-extended-stay-180.test.ts`, `test/guest-criteria-strip.test.ts`, `test/guest-discovery-reasons.test.ts`, `test/guest-draft-revision.test.ts`, `test/assistant-tool-authorization.test.ts` (its `maximum-range` case moved from 15 to 30 nights so it still exercises the boundary).
- No new constant. No file under `apps/` changed. `test/demo-extended-assistant.test.ts` not changed.

**Commands and counts**
- `env -u LLM_API_KEY npx tsx --test test/short-stay-29-nights.test.ts`: 5 pass, 0 fail (final run).
- `env -u LLM_API_KEY npx tsx --test <26 affected domain and app-facing test files>` (the grep set minus chromium files and `demo-extended-assistant`): 210 tests, 210 pass, 0 fail (final run, after all edits).
- `env -u LLM_API_KEY npx tsx --test test/demo-extended-assistant.test.ts`: 1 pass, 0 fail (run only to report; not touched).
- `env -u LLM_API_KEY npm run check`: passes with zero type errors, and the worker-bundle guard passes.
- Not run, per Test scope: full `npm test`, `npm run test:workers`, and any chromium or real-browser file. No `apps/cloudflare/test` spec asserts the 14-night limit, so no Worker spec was run.

**ADRs applied**
- 0023 (amended 1 Nov 2026): Short Stay 1 to 29 nights through `MAX_STAY_NIGHTS`; 30+ refused at search, quote and draft (AC1, AC2); amendments within 29 nights accepted, 30 refused (AC4).
- 0092 (amended 1 Nov 2026): Extended Stay 30 to 180 nights from policy; no new constant (AC3).
- 0055: the 90-day horizon still applies to check-in only; the latest-checkout bound grows by 15 days through `MAX_STAY_NIGHTS`, as the issue describes.
- 0024: `revenue-release.ts` has no night check (see below).
- 0105: the demo policy is unchanged (AC3).

**AC evidence**
- AC1 to AC5 each have a named `test()` in `test/short-stay-29-nights.test.ts`. AC4 covers the Short Stay extension to 29 nights (accepted) and to 30 nights (refused with the 29-night message).
- AC5 is a source scan of `domains/shortlet/src/*.ts` code lines for stay-length comparisons against 14 or "14-night" wording. It finds none. The 14-day review window (`verified-stay-review.ts`) and the 14-day Notice to End and T-14d cancellation values are not stay-length limits and are not matched.

**revenue-release.ts night check (ADR 0024)**
`domains/shortlet/src/revenue-release.ts` has no reference to nights or any stay-length comparison (zero "night" matches, zero `14` literals). Its payout logic is keyed on checkout, payout plan and risk hold. No change needed.

**Left for other issues or the owner (not changed here)**
- `apps/local-guest/src/landing-copy.ts:12` still has `LAUNCH_MAX_STAY_NIGHTS = 14` for the example chip validator, and a comment at `apps/local-guest/src/concierge.ts:612` still says "one through fourteen nights". `concierge.ts` itself already reads `MAX_STAY_NIGHTS`. These are `apps/` and belong to issues 02, 03 and 05.
- Extended Stay contracts: `requestAmendment` now refuses any contract whose stay would exceed 29 nights, including an Extended Stay. It refused more than 14 before this change, so the behaviour is unchanged, but the ADR amendment does not settle Extended Stay amendments. Flagged, not changed.
- Trust-record refresh deadline: with the stay-length term at 29, the trust-record window is 119 days, not 104. For the staging CSV expiry of 2027-12-31 that moves the offer cut-off from about 19 Sep 2027 to about 3 Sep 2027. The owner should plan the refresh against 3 Sep 2027.
- DoD item 7 asks for `npm test` to pass. Per the batch Test scope, the full suite runs once before the merge to main, not per issue.

**Acceptance criteria**
- AC1: pass (named test). AC2: pass (named test). AC3: pass (named test). AC4: pass (named test). AC5: pass (named test).
