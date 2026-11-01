# Map: Short Stays of 1 to 29 nights

Decision: ADR 0023 as amended 1 Nov 2026, and ADR 0092 as amended the same day. A Short Stay is 1 to 29 nights. An Extended Stay is 30 to 180 nights (1 to 6 months). There is no unsupported gap between them.

Today the code still caps Short Stays at 14 nights, and refuses 15 to 29 nights everywhere. Production has no Extended Stay policy, so it refuses every stay over 14 nights; only the staging demo supplies one (30 to 180 nights, `DEMO_EXTENDED_STAY_POLICY`). After this effort, every deployment, production included, accepts 1 to 29-night Short Stays and 30 to 180-night Extended Stays at opted-in units (owner decision 1 Nov 2026, issue 05).

Work top to bottom. The frontier is the first issue that is open, unblocked and unclaimed. Per issue: `npm run check` plus the issue's own and affected tests (AGENTS.md, "Test scope"). The full `npm test` and `npm run test:workers` run once, after issues 01, 02, 03 and 05 are resolved, before any merge to main.

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 01 | [Booking service accepts Short Stays of 1 to 29 nights](issues/01-booking-service-short-stays-to-29-nights.md) | task | ready-for-agent | none |
| 02 | [Concierge and assistant accept 1 to 29 nights](issues/02-concierge-and-assistant-short-stays-to-29-nights.md) | task | ready-for-agent | 01 |
| 03 | [Landing chip validator follows the Short Stay limit](issues/03-landing-chip-validator-follows-short-stay-limit.md) | task | ready-for-agent | 01 |
| 04 | [Decide how Continuous Occupancy is enforced](issues/04-decide-continuous-occupancy-enforcement.md) | grilling | resolved | none |
| 06 | [Enforce Continuous Occupancy across back-to-back stays](issues/06-enforce-continuous-occupancy.md) | task | ready-for-agent | 04 |
| 05 | [Turn on Extended Stays in every deployment, including production](issues/05-turn-on-extended-stays-in-every-deployment.md) | task | ready-for-agent | 01 |

## Not in this effort

- Landing page monthly-stay copy (reopens landing issue 13 item 4).
- Counsel's text for the three ADR 0092 [counsel text] items (monthly-stays issue 02).

## Pre-merge gate fixes (1 Nov 2026)

Four failures from the pre-merge gate, plus one parser defect found while fixing them. Extended Stays are on in every composition (ADR 0092, amended 1 Nov 2026), so the first refused length is 181 nights.

1. **Deep import (AC4, `test/domain-boundary.test.ts`).** `apps/local-guest/src/landing-copy.ts` imports `MAX_STAY_NIGHTS` from `domains/shortlet/src/index.js` (ADR 0099). The allow-list is unchanged. `test/landing-chip-limit.test.ts` AC2 now asserts that index import.
2. **Discovery refusal (`test/guest-discovery-reasons.test.ts`, AC3).** The out-of-range example is 181 nights. The asserted message is `Stays can be at most 180 nights.` (`dateLimitRefusal`, contiguous-policy branch).
3. **Draft refusal (`test/guest-draft-revision.test.ts`).** Retitled to "a stay over the 180-night maximum is refused and the draft is unchanged". Input "make it 181 nights". Asserts `^Stays can be at most 180 nights\. Please choose 180 nights or fewer\.$`.
4. **Publication date (`test/onboard-and-publish-one-inspected-unit.test.ts`).** The furthest checkout is derived as `BOOKING_HORIZON_DAYS + MAX_STAY_NIGHTS` after 2026-07-22, which is 2026-11-18. Added a refusal for an inspection expiring one day earlier, and the boundary expiry now uses the derived date.

**Parser defect (found while fixing 2 and 3).** `NIGHTS_PATTERN` in `apps/local-guest/src/concierge.ts` read only one or two digits. "for 181 nights" and "for 100 nights" were never extracted, so guests were asked "how many nights" or got a search-refinement reply. Fixed to `\d{1,3}`. New test: "Extended Stay lengths of 100 to 180 nights are read from guest text" in `test/guest-discovery-reasons.test.ts`. It covers 21, 120 and 180 nights and the 181-night refusal.

Other night-count parsers checked (`grep -rn '\d{1,2}' apps/local-guest/src apps/web-agent/src` filtered for night terms):
- `apps/local-guest/src/concierge.ts:163`: the only two-digit night parser. Widened.
- `apps/local-guest/src/assistant/scripted-assistant-model.ts:266`: already `\d+`. Unchanged.
- `apps/web-agent/src/discovery-a2ui.ts:197`: a date-format check, not a night count. Unchanged.

Commands and counts:
- `env -u LLM_API_KEY npx tsx --test test/domain-boundary.test.ts test/guest-discovery-reasons.test.ts test/guest-draft-revision.test.ts test/onboard-and-publish-one-inspected-unit.test.ts test/landing-chip-limit.test.ts test/landing-page.test.ts test/assistant-short-stays-29-nights.test.ts test/guest-criteria-strip.test.ts`: 77 tests, 77 pass, 0 fail.
- `env -u LLM_API_KEY npx tsx --test test/assistant-short-stays-29-nights.test.ts test/guest-criteria-strip.test.ts`: 14 tests, 14 pass (subset of the run above).
- `env -u LLM_API_KEY npm run check`: exit 0, clean.
