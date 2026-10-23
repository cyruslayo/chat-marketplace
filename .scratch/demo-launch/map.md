# Demo launch map

Parent: [PRD.md](PRD.md)

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 01 | [Record the public demo exception ADR](issues/01-record-public-demo-exception-adr.md) | HITL | resolved | none |
| 02 | [Run the concierge on GPT-6 Luna via OpenRouter](issues/02-run-concierge-on-gpt6-luna-via-openrouter.md) | AFK | resolved | 01 |
| 03 | [Benchmark GPT-6 Luna against the baseline](issues/03-benchmark-gpt6-luna.md) | AFK | ready-for-human | 02 |
| 04 | [Add a staging-only demo mode](issues/04-add-staging-only-demo-mode.md) | AFK | resolved | 01 |
| 05 | [Seed demo apartments with photos](issues/05-seed-demo-apartments-with-photos.md) | AFK | resolved | 04, 08, 09, 10, 11, 12, 13 |
| 06 | [Deploy the demo to Cloudflare staging](issues/06-deploy-demo-to-cloudflare-staging.md) | HITL | ready-for-human | 02, 03, 04, 05 |
| 07 | [Verify the live demo journey end to end](issues/07-verify-live-demo-journey.md) | AFK | ready-for-agent | 03, 06, 08, 09, 10, 11, 12, 13 |
| 08 | [Wire a 30-night demo Extended Stay through booking and payment](issues/08-one-period-demo-extended-stay.md) | AFK | resolved | 04 |
| 09 | [Extend demo quotes and contracts through 180 nights](issues/09-extend-demo-stays-to-180-nights.md) | AFK | resolved | 08 |
| 10 | [Pay each demo Billing Period through a separate payment session](issues/10-pay-each-demo-billing-period.md) | AFK | resolved | 09 |
| 11 | [Capture demo Owner Payables per Billing Period](issues/11-capture-demo-owner-payables-per-period.md) | AFK | resolved | 10 |
| 12 | [Show demo monthly prices and payment periods in guest screens](issues/12-show-demo-monthly-prices-and-periods.md) | AFK | resolved | 09, 10, 11, 13 |
| 13 | [Demo monthly cancellation, Notice to End and overdue handling](issues/13-demo-monthly-cancellation-notice-and-overdue-handling.md) | AFK | resolved | 09, 10, 11 |

## Frontier

04, 05 and 08–13 are resolved. Issue 03 now has three passing live journeys after diagnosis and fixes on 23 October 2026.
The four-turn scripted reference also passes. Issue 03 is `ready-for-human` for benchmark acceptance.
Issues 06 and 07 remain subject to benchmark acceptance, deployment requirements, and live staging verification.
Issue 06 stays `ready-for-human`. Deployment needs explicit authorization, clean-checkout checks, and confirmation of the staging operator-import cutover state.
Issue 11 leaves the back-office payables screen showing Period 1 only. See its deviations.

```
01 → 02 ────────────────┐
     03 (review GO) ────┤
01 → 04 → 08 → 09 → 10 → 11 ─┬→ 12 ─┐
                              └→ 13 ─┤
                                 05 → 06 → 07
```

## Context pointers

- 01: [ADR 0105](../../docs/adr/0105-public-demo-exception.md) records the accepted demo exception. ADR 0104 notes its demo-only partial supersession. Four dedicated tests and the complete suite passed.

- 04: the staging demo is off by default and refused in production (ADR 0105). Its acceptance runs the owner confirmation command path. Tests: test/demo-mode-config.test.ts, test/demo-mode-guest.test.ts, test/demo-auto-accept.test.ts, test/demo-listing-chip.test.ts, test/demo-accept-delay-config.test.ts, test/demo-mode-landing.test.ts. Captures: .scratch/demo-launch/screenshots/04/. Open items are in the issue Comments.

- 03: `ready-for-human`, with all ACs checked and a passing three-journey benchmark. Unknown search defaults, detail-price context, and mandatory-fee grading were fixed. All 12 live stages and the four-turn scripted reference pass. Type checking passed; focused tests passed 29 of 29; assistant tests passed 56 of 56. Total reported key usage is USD 0.009090460. Initial failed evidence is preserved. See the benchmark and issue Comments for acceptance limits.

- 05: Resolved. Eight synthetic units (6 Lagos, 2 Abuja) and one synthetic operator are in apps/cloudflare/demo/ CSVs. The 35 photos are re-downloaded from Unsplash and credited in apps/cloudflare/public/demo/photos/CREDITS.md (the earlier unattributed download was not usable). scripts/demo-provision.ts (npm run demo:provision) imports through /_ops, idempotently. Implementation commit 910a0af. Tests: test/demo-apartments.test.ts and test/demo-provision.test.ts (17 of 17). Walkthrough captures: .scratch/demo-launch/screenshots/05/. Risk for issue 06: operators go through /_ops/import, which is refused after cutover.

- 11: Resolved. Each Billing Period of an Extended Stay has its own owner payable and margin, captured in the quote snapshot at confirmation. Period 1 is due under ADR 0089 and each later period once its payment is verified, its first night has begun and no complaint is open (ADR 0092). Payouts and recoveries bind to one period. Commit c4b3998 (implementation), then the tracker commit. Tests: test/owner-payable-per-period.test.ts (6 of 6); affected Node set 301 of 301; affected Worker specs 43 of 43 and 2 of 2. Open: the back-office screen does not show later periods; the period payment tables are still not in the daily export; cancellation allocation per period is issue 13's.
- 10: Resolved. Each later Billing Period of a staging demo Extended Stay is paid through its own Paystack TEST session, persisted in the shared store (Node and the Cloudflare object). Tests: test/pay-each-demo-billing-period.test.ts (AC1 to AC9, 10 of 10). Open items: the back-office list is an application method with no page or route yet; no Worker-level period journey; the period tables are not in the daily export (ADR 0096 covers four named columns only). The Comments list the owner and counsel decisions.

- 08–13: The owner authorized a synthetic staging-only 180-night Extended Stay on 22 Oct 2026. ADR 0105 records the exception. Production remains at ADR 0092's 30–90-night policy. The implementation chain uses the monthly-stays rules without resolving that separate tracker.

- 09: Resolved. The staging demo accepts 30 to 180 nights (six Billing Periods) under the amended ADR 0105; production stays at 30 to 90 nights (ADR 0092). The first Period Payment collects one Billing Period only. Node and Worker suites pass: see the issue Comments. Tests: test/demo-extended-stay-180.test.ts and test/helpers/demo-extended-journey.ts.

- 08: Resolved with a staging-only 30-night Node and Worker path. The quote captures one Billing Period with zero Extended Stay deposit. Focused Node tests passed 133/133; pilot and restart tests passed 49/49; focused Worker tests passed 21/21, with the final Worker path passing 2/2 after the quote correction. Responsive captures are in `screenshots/08/`.

- 04: the staging demo is off by default and refused in production (ADR 0105). Its acceptance runs the owner confirmation command path. Tests: test/demo-mode-config.test.ts, test/demo-mode-guest.test.ts, test/demo-auto-accept.test.ts, test/demo-listing-chip.test.ts, test/demo-accept-delay-config.test.ts, test/demo-mode-landing.test.ts. Captures: .scratch/demo-launch/screenshots/04/. Open items are in the issue Comments.

- 13: Implementation committed at 8312ab7; round 2 at 9c3b55f (owner payable persisted per period, cut-short periods, guest contract wording). Status stays `ready-for-agent`: captures for the contract and confirmation screen are still missing. Tests: test/demo-extended-cancellation-notice.test.ts 30 of 30; affected set 105 of 106 with one parallel-load flake that passes alone (5 of 5); Worker demo spec 2 of 2. Details in the issue Comments.

- 12: Partly implemented in commit b610f67, status stays `ready-for-agent`. The chat discovery card, unit detail and request review show the monthly price, included utilities and the six-or-fewer Billing Period schedule, with the amount due now labelled as the first period only. Test: test/demo-monthly-prices-and-periods.test.ts (8 of 8). Captures: screenshots/12/ (30-night only). Open: the later-period payment screen and Worker path (AC4), standalone unit detail parity, the 180-night review capture, the Worker demo spec re-run inside operator hours, and the client bundle commit. Details in the issue Comments.

- 12 (round 3): Still `ready-for-agent`. Done: Worker spec clock fixed (b14251c); standalone unit page parity (b509eeb); 180-night request review capture (c68e4c2); later-period schedule page, start route and callback (6cd82c7, untested). Open: red-first tests and the Worker spec for the later-period route, schedule captures, and the chat version. Follow-up for the owner, not an issue 12 AC: back-office payables show Period 1 only, payout and recovery POSTs send no `periodIndex`, and Notice-to-End reductions are not shown. That blocks real period-N payouts in the back office, not the guest demo journey.

- 12 (round 4): Still `ready-for-agent`. Done: later-period route tests 11 of 11 with mutation checks (fbac91d); Worker later-period spec 1 of 1 (fbac91d); schedule page captures 8 PNG with no findings (4fb3360). Open: the chat-workspace version of the schedule (AC4 parity), and a cold-start defect in the Worker (the first HTTP request to a restarted Durable Object fails on `guest_threads`) that needs its own issue. Owner follow-up unchanged: back-office payables per period.

- 12 (round 5): Still `ready-for-agent`. Cold-start defect root-caused and fixed (0ef32b5): the session thread set is read through the platform port in the split (ADR 0101). Open: the chat link to the schedule (AC4 parity, blocked: one conventional-route slot per chat surface); the combined-run flakiness (not reproduced per file); the Worker empty-email risk; owner items (back-office per-period payables; dist rebuild).
