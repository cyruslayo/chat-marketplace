# Rules 01: a booking after it is confirmed

Status: gate 1 and gate 2 passed (owner answers D3, D4, D23–D32, 25 Nov 2026)
Covers: cancel, no-show, change (Booking Amendment), extend, Notice to End, Period Payment, blocking complaint, check-in, refund, dates, Owner Payable
Dated scope note (25 Nov 2026, D32): deposit claims (ADR 0016–0020) are deferred until deposit collection is enabled (zero deposit in pilot, ADR 0089, ADR 0092); relocation (ADR 0028–0029) is deferred until the Guest Protection Fund is activated (refund-only in pilot, ADR 0089, ADR 0091). No-Show (ADR 0058) is covered in the table below.

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
| S1 | Once a Reservation is `cancelled` or `no_show`, no command changes its contract or collects money for it | 0058, 0060, D29 (25 Nov 2026) | **Broken** for amendments (trial A), extensions, notice, and complaint uphold |
| S2 | Money verified after that is recorded for refund and never revives the stay | 0045, 0046, 0092, D23 (25 Nov 2026), `docs/policy/shortlet-pilot-payments.md` | Amendment, period after cancellation: not checked. Code defect (ADR 0046, AGENTS.md): a late card success on a superseded or reminted reference is ignored, with nothing recorded |
| S3 | A guest is charged at most once for the same obligation | 0046, 0072 | Period: yes. Amendment: not checked |
| S4 | Total refunded never exceeds total paid, per payment and per booking | 0058, 0061, D28 (25 Nov 2026) | Not checked |
| S5 | Dates are released at most once, and only after the Reservation left `confirmed` | 0041, 0058 | Not checked |
| S6 | A cancelled, notice-ended or upheld night never stays owed to the owner | 0089, 0092, 0061 | Notice: yes. Cancel: not wired |
| S7 | The deposit is never mixed into the stay refund | 0016, 0058 | Separate in code |
| S8 | Only the Primary Guest cancels, changes, extends or gives notice; only the Operator approves an extension; only staff record refunds | 0012, 0060, 0072, 0082 | Per class; no table |
| S9 | A command built on an older contract version, notice date or policy version changes nothing | 0060, 0074 | Yes per class |
| S10 | The agent never confirms or cancels | 0080 | Yes |
| S11 | Extension waiting and Notice to End exclude each other | 0092 | Yes, tested |
| S12 | An open complaint blocks Change commit, Extension approve, Notice to End and ordinary guest cancellation after arrival | 0061, 0021, D30 (25 Nov 2026) | Notice: yes. Cancel: arrival state only. Change/Extension: not wired |
| S13 | After a Notice to End no later Billing Period can be started | 0092 | Yes (trial D) |
| S14 | The guest is never told "refunded" before the refund is settled | 0045, 0078 | Screen rule |

## P rules: must eventually happen

| # | Rule | Who finishes it | Today |
| --- | --- | --- | --- |
| P1 | A cancelled Reservation ends with ledger posted, dates released and each refund settled or an owned staff item | D4 | **Broken**: no resume (trial B) |
| P2 | Every recorded refund shows on the Operator home until it is paid (cancellation, upheld complaint, Notice to End, late Period Payment, superseded reference) | Staff (D4, 0091, D28, 25 Nov 2026) | Upheld complaint: yes. Cancel / Notice / Period / Superseded: no |
| P3 | A proposed or accepted change ends (committed, rejected, expired or closed by cancellation); non-extension Booking Amendments carry an expiry bound to ADR 0060 cutoffs / Payment Window (issue 19) | Clock, or cancellation (0060, D3, D31, 25 Nov 2026) | Expires only if it has a deadline |
| P4 | The guest can always see the current state and one next step, even after a failure | Screen (D4, 0074) | Cancel: no action remains |
| P5 | A problem report reaches a named person | ADR 0030; operational rota D6, D18 | No intake |

## Cross-check: B arrives while A is unfinished

`ok` = settled on `main`; `D3` etc. = owner; `n/a (stay type)` = Short Stay (`BookingAmendmentManager`, <=29 nights, ADR 0023 as amended) vs Extended Stay (30–180 nights, ADR 0092; reopen if D17 opens non-date Booking Amendments on Extended Stays).

| A ↓ / B → | Cancel | Change commit | Extension approve | Notice | Period paid | Complaint upheld |
| --- | --- | --- | --- | --- | --- | --- |
| **Cancel, half done** | P1 | S1, D3 | S1, D29 | S1, D29 | S2, D23 | S1, D29 |
| **No-Show confirmed (0058, D32)** | S1 (terminal) | S1, D29 | S1, D29 | n/a (pre-access, 0058, 0092) | S2, D23, D32 | S1, D29 |
| **Change accepted, unpaid** | D3 | – | n/a (stay type) | n/a (stay type) | n/a (stay type) | close, D25 |
| **Change payment in flight** | D3 | S3 | n/a (stay type) | n/a (stay type) | S3 | settle & refund, D25 |
| **Extension waiting** | close, D29 | n/a (stay type) | – | ok (S11) | ok (0092) | close, D30 |
| **Notice recorded** | 0058, 0092 (guest refused); 0014 (failure override) | n/a (stay type) | ok (S11) | ok | ok (S13) | override kept nights, D27 |
| **Period payment in flight** | settle & refund, D23 | n/a (stay type) | ok (0092) | refuse while in flight; late refund, D24 | S3 ok | settle & refund, D26 |
| **Complaint open** | S12 | refuse, D30 | refuse, D30 | ok (S12) | ok; payable paused (0092) | – |

All 26 previously open cells and No-Show rules settled on 25 Nov 2026 via ADRs and owner decisions D23–D32.

## Scenarios for the owner

1. Ada accepts a one-night change, then cancels before paying for it. **Accepted (D3):** the change closes and nothing is charged.
2. Ada pays for the change, the payment is still being checked, and she cancels. **Accepted (D3):** the payment is settled first, then refunded with the stay.
3. Ada cancels and the refund request fails. **Accepted (D4):** she sees "Cancelled" and the refund's state; staff see a refund to pay.
4. Ada cancels and the dates fail to release. **Accepted (D4):** her refund still proceeds; the release is retried.
5. Ada asks to extend, and cancels before the Operator answers. **Accepted (D29, 25 Nov 2026):** the extension request closes.
6. Ada's period payment succeeds after she cancelled. **Accepted (D23, 25 Nov 2026):** recorded for manual refund, the stay stays cancelled. (S2)
7. Staff uphold a complaint from night 3 while a change is unpaid. **Accepted (D25, 25 Nov 2026):** the change closes; the upheld refund uses the captured nights. (If change payment is in flight, it settles first and is recorded for full refund alongside the upheld stay refund.)
8. Ada gives notice, then wants to cancel. **Settled (0058, 0092, 0014):** no voluntary cancellation after Verified Access; notice stands. (Reviewed failure override under ADR 0014 / ADR 0061 still applies.)

## Check design

- **Order check:** request, accept, commit, cancel, request extension, approve, give notice, start period, verify period, uphold. Short Stay and Extended Stay separately, to the greatest depth that fits 30 seconds with pruning (issue 03 AC6); deeper from a script.
- **Failure check:** each external port fails once, at every point, with three resumes. P1 to P4 at the end.
- **Clock:** three instants per stay: before the free-cancellation limit, between limits, after Verified Access.
- **Money:** a recording port totals collected and refunded kobo. S3, S4, S7 are sums over it.
- **Reached:** the check asserts that each step succeeded in at least one order.
- **Stores:** SQLite contract, Reservation, period and check-in stores.
