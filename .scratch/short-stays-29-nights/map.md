# Map: Short Stays of 1 to 29 nights

Decision: ADR 0023 as amended 1 Nov 2026, and ADR 0092 as amended the same day. A Short Stay is 1 to 29 nights. An Extended Stay is 30 to 180 nights (1 to 6 months). There is no unsupported gap between them.

Today the code still caps Short Stays at 14 nights, and refuses 15 to 29 nights everywhere. Production has no Extended Stay policy, so it refuses every stay over 14 nights; only the staging demo supplies one (30 to 180 nights, `DEMO_EXTENDED_STAY_POLICY`). After this effort, production accepts 1 to 29 nights and still refuses 30 or more until a separate decision turns Extended Stays on there.

Work top to bottom. The frontier is the first issue that is open, unblocked and unclaimed. Per issue: `npm run check` plus the issue's own and affected tests (AGENTS.md, "Test scope"). The full `npm test` and `npm run test:workers` run once, after all four issues are resolved, before any merge to main.

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 01 | [Booking service accepts Short Stays of 1 to 29 nights](issues/01-booking-service-short-stays-to-29-nights.md) | task | ready-for-agent | none |
| 02 | [Concierge and assistant accept 1 to 29 nights](issues/02-concierge-and-assistant-short-stays-to-29-nights.md) | task | ready-for-agent | 01 |
| 03 | [Landing chip validator follows the Short Stay limit](issues/03-landing-chip-validator-follows-short-stay-limit.md) | task | ready-for-agent | 01 |
| 04 | [Decide how Continuous Occupancy is enforced](issues/04-decide-continuous-occupancy-enforcement.md) | grilling | ready-for-human | none |

## Not in this effort

- Turning Extended Stays on in production (no production `ExtendedStayPolicy` exists yet).
- Landing page monthly-stay copy (reopens landing issue 13 item 4).
- Counsel's text for the three ADR 0092 [counsel text] items (monthly-stays issue 02).
