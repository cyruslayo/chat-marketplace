# Rules 01: a booking after it is confirmed

Status: draft, gate 1 not passed
Covers: cancel, change (Booking Amendment), extend, Notice to End, Period Payment, blocking complaint, check-in, refund, dates, Owner Payable
Not covered yet: deposit claims (ADR 0017–0020), relocation (0028, 0029), no-show. They join before phase 4 closes.

Terms are from `domains/shortlet/CONTEXT.md`. "In flight" means payment has started and is not yet verified, failed or superseded.

## Machines

| Machine | States | Source on `main` | Persisted |
| --- | --- | --- | --- |
| Reservation | confirmed → cancelled, no_show | `RESERVATION_TRANSITIONS` | Yes |
| Booking Contract | version only | `mutateContract` version check | Yes |
| Booking Amendment | proposed, accepted, awaiting_financial_settlement, committed, rejected, expired | `AMENDMENT_TRANSITIONS` | **No** |
| Extension | awaiting_operator → approved, declined, expired | `extended-stay-extension.ts` | In the contract |
| Notice to End | absent, recorded | `contract.noticeToEnd` | In the contract |
| Billing Period | scheduled, payable, paid, overdue, unpaid_at_start | Projected from the clock | Payments: yes |
| Cancellation case | ledger, dates, refund and deposit statuses | `CancellationCase` | **No** |
| Blocking Fulfilment Complaint | open → dismissed, upheld | Check-in store | Yes |
| Refund obligation | pending, settled, failed, reconciliation_required | Several, not shared | Part |

## S rules: must never happen

| # | Rule | Source | Today |
| --- | --- | --- | --- |
| S1 | Once a Reservation is `cancelled` or `no_show`, no command changes its contract or collects money for it | 0058, 0060; **Proposed** as one rule | **Broken** for amendments (trial A) |
| S2 | Money verified after that is recorded for refund and never revives the stay | 0045, 0092 | Amendment, period after cancellation: not checked. Known gap (AGENTS.md, ADR 0046): a late card success on a superseded or reminted reference is ignored, with nothing recorded |
| S3 | A guest is charged at most once for the same obligation | 0046, 0072 | Period: yes. Amendment: not checked |
| S4 | Total refunded never exceeds total paid, per payment and per booking | 0058, 0061; **Proposed** as a sum rule | Not checked |
| S5 | Dates are released at most once, and only after the Reservation left `confirmed` | 0041, 0058 | Not checked |
| S6 | A cancelled, notice-ended or upheld night never stays owed to the owner | 0089, 0092, 0061 | Notice: yes. Cancel: not wired |
| S7 | The deposit is never mixed into the stay refund | 0016, 0058 | Separate in code |
| S8 | Only the Primary Guest cancels, changes, extends or gives notice; only the Operator approves an extension; only staff record refunds | 0012, 0060, 0072, 0082 | Per class; no table |
| S9 | A command built on an older contract version, notice date or policy version changes nothing | 0060, 0074 | Yes per class |
| S10 | The agent never confirms or cancels | 0080 | Yes |
| S11 | Extension waiting and Notice to End exclude each other | 0092 | Yes, tested |
| S12 | An open complaint blocks Notice to End and ordinary guest cancellation after arrival | 0061, 0021 | Notice: yes. Cancel: arrival state only |
| S13 | After a Notice to End no later Billing Period can be started | 0092 | Yes (trial D) |
| S14 | The guest is never told "refunded" before the refund is settled | 0045, 0078 | Screen rule |

## P rules: must eventually happen

| # | Rule | Who finishes it | Today |
| --- | --- | --- | --- |
| P1 | A cancelled Reservation ends with ledger posted, dates released and each refund settled or an owned staff item | D4 | **Broken**: no resume (trial B) |
| P2 | Every recorded refund shows on the Operator home until it is paid | Staff | Upheld complaint: yes. Cancel: no |
| P3 | A proposed or accepted change ends (committed, rejected, expired or closed by cancellation) | Clock, or cancellation | Expires only if it has a deadline |
| P4 | The guest can always see the current state and one next step, even after a failure | Screen | Cancel: no action remains |
| P5 | A problem report reaches a named person | D6, D18 | No intake |

## Cross-check: B arrives while A is unfinished

`ok` = settled on `main`; `D3` etc. = owner; `?` = rule to write before gate 1.

| A ↓ / B → | Cancel | Change commit | Extension approve | Notice | Period paid | Complaint upheld |
| --- | --- | --- | --- | --- | --- | --- |
| **Cancel, half done** | P1 | S1, D3 | S1 ? | S1 ? | S2 ? | ? |
| **Change accepted, unpaid** | D3 | – | ? | ? | ? | ? |
| **Change payment in flight** | D3 | S3 | ? | ? | S3 | ? |
| **Extension waiting** | ? | ? | – | ok (S11) | ok? confirm | ? |
| **Notice recorded** | ? | ? | ok (S11) | ok | ok (S13) | ? |
| **Period payment in flight** | ? | ? | ? | ? | S3 ok | ? |
| **Complaint open** | S12 | ? | ? | ok (S12) | ? | – |

There are 26 cells still to settle. Each becomes one scenario for the owner or one citation.

## Scenarios for the owner

1. Ada accepts a one-night change, then cancels before paying for it. **Accepted (D3):** the change closes and nothing is charged.
2. Ada pays for the change, the payment is still being checked, and she cancels. **Accepted (D3):** the payment is settled first, then refunded with the stay.
3. Ada cancels and the refund request fails. **Accepted (D4):** she sees "Cancelled" and the refund's state; staff see a refund to pay.
4. Ada cancels and the dates fail to release. **Accepted (D4):** her refund still proceeds; the release is retried.
5. Ada asks to extend, and cancels before the Operator answers. **Proposed:** the extension request closes.
6. Ada's period payment succeeds after she cancelled. **Proposed:** recorded for refund, the stay stays cancelled. (S2)
7. Staff uphold a complaint from night 3 while a change is unpaid. **Proposed:** the change closes; the upheld refund uses the captured nights.
8. Ada gives notice, then wants to cancel. **Proposed:** no cancellation after Verified Access; notice stands. (0058, 0092)

## Check design

- **Order check:** request, accept, commit, cancel, request extension, approve, give notice, start period, verify period, uphold. Short Stay and Extended Stay separately, to the greatest depth that fits 30 seconds with pruning (issue 03 AC6); deeper from a script.
- **Failure check:** each external port fails once, at every point, with three resumes. P1 to P4 at the end.
- **Clock:** three instants per stay: before the free-cancellation limit, between limits, after Verified Access.
- **Money:** a recording port totals collected and refunded kobo. S3, S4, S7 are sums over it.
- **Reached:** the check asserts that each step succeeded in at least one order.
- **Stores:** SQLite contract, Reservation, period and check-in stores.
