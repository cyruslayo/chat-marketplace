# Demo launch map

Parent: [PRD.md](PRD.md)

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 01 | [Record the public demo exception ADR](issues/01-record-public-demo-exception-adr.md) | HITL | resolved | none |
| 02 | [Run the concierge on GPT-6 Luna via OpenRouter](issues/02-run-concierge-on-gpt6-luna-via-openrouter.md) | AFK | resolved | 01 |
| 03 | [Benchmark GPT-6 Luna against the baseline](issues/03-benchmark-gpt6-luna.md) | AFK | needs-info | 02 |
| 04 | [Add a staging-only demo mode](issues/04-add-staging-only-demo-mode.md) | AFK | resolved | 01 |
| 05 | [Seed demo apartments with photos](issues/05-seed-demo-apartments-with-photos.md) | AFK | claimed | 04, 08, 09, 10, 11, 12, 13 |
| 06 | [Deploy the demo to Cloudflare staging](issues/06-deploy-demo-to-cloudflare-staging.md) | HITL | ready-for-human | 02, 03, 04, 05 |
| 07 | [Verify the live demo journey end to end](issues/07-verify-live-demo-journey.md) | AFK | ready-for-agent | 03, 06, 08, 09, 10, 11, 12, 13 |
| 08 | [Wire a 30-night demo Extended Stay through booking and payment](issues/08-one-period-demo-extended-stay.md) | AFK | resolved | 04 |
| 09 | [Extend demo quotes and contracts through 180 nights](issues/09-extend-demo-stays-to-180-nights.md) | AFK | resolved | 08 |
| 10 | [Pay each demo Billing Period through a separate payment session](issues/10-pay-each-demo-billing-period.md) | AFK | resolved | 09 |
| 11 | [Capture demo Owner Payables per Billing Period](issues/11-capture-demo-owner-payables-per-period.md) | AFK | ready-for-agent | 10 |
| 12 | [Show demo monthly prices and payment periods in guest screens](issues/12-show-demo-monthly-prices-and-periods.md) | AFK | ready-for-agent | 09, 10, 11, 13 |
| 13 | [Demo monthly cancellation, Notice to End and overdue handling](issues/13-demo-monthly-cancellation-notice-and-overdue-handling.md) | AFK | ready-for-agent | 09, 10, 11 |

## Frontier

04, 08, 09 and 10 are resolved. 05 remains claimed and is blocked on the monthly booking chain 11–13. Issue 11 is the next implementation frontier. Issue 03 is independent of that domain work, but needs an owner-supplied OpenRouter credential for its live runs; it remains `needs-info` and blocks staging deployment and live acceptance. Issue 06 stays `ready-for-human` and requires the pre-deploy gate plus explicit deployment authorization.

```
01 → 02 ────────────────┐
     03 (needs-info) ───┤
01 → 04 → 08 → 09 → 10 → 11 ─┬→ 12 ─┐
                              └→ 13 ─┤
                                 05 → 06 → 07
```

## Context pointers

- 01: [ADR 0105](../../docs/adr/0105-public-demo-exception.md) records the accepted demo exception. ADR 0104 notes its demo-only partial supersession. Four dedicated tests and the complete suite passed.

- 04: the staging demo is off by default and refused in production (ADR 0105). Its acceptance runs the owner confirmation command path. Tests: test/demo-mode-config.test.ts, test/demo-mode-guest.test.ts, test/demo-auto-accept.test.ts, test/demo-listing-chip.test.ts, test/demo-accept-delay-config.test.ts, test/demo-mode-landing.test.ts. Captures: .scratch/demo-launch/screenshots/04/. Open items are in the issue Comments.

- 10: Resolved. Each later Billing Period of a staging demo Extended Stay is paid through its own Paystack TEST session, persisted in the shared store (Node and the Cloudflare object). Tests: test/pay-each-demo-billing-period.test.ts (AC1 to AC9, 10 of 10). Open items: the back-office list is an application method with no page or route yet; no Worker-level period journey; the period tables are not in the daily export (ADR 0096 covers four named columns only). The Comments list the owner and counsel decisions.

- 08–13: The owner authorized a synthetic staging-only 180-night Extended Stay on 22 Oct 2026. ADR 0105 records the exception. Production remains at ADR 0092's 30–90-night policy. The implementation chain uses the monthly-stays rules without resolving that separate tracker.

- 09: Resolved. The staging demo accepts 30 to 180 nights (six Billing Periods) under the amended ADR 0105; production stays at 30 to 90 nights (ADR 0092). The first Period Payment collects one Billing Period only. Node and Worker suites pass: see the issue Comments. Tests: test/demo-extended-stay-180.test.ts and test/helpers/demo-extended-journey.ts.

- 08: Resolved with a staging-only 30-night Node and Worker path. The quote captures one Billing Period with zero Extended Stay deposit. Focused Node tests passed 133/133; pilot and restart tests passed 49/49; focused Worker tests passed 21/21, with the final Worker path passing 2/2 after the quote correction. Responsive captures are in `screenshots/08/`.

- 04: the staging demo is off by default and refused in production (ADR 0105). Its acceptance runs the owner confirmation command path. Tests: test/demo-mode-config.test.ts, test/demo-mode-guest.test.ts, test/demo-auto-accept.test.ts, test/demo-listing-chip.test.ts, test/demo-accept-delay-config.test.ts, test/demo-mode-landing.test.ts. Captures: .scratch/demo-launch/screenshots/04/. Open items are in the issue Comments.
