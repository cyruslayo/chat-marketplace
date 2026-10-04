# Decide the Extended Stay policy (ADR 0092 and glossary)

Status: resolved
Type: grilling
Blocked by: 02 (counsel's answers fix some values; drafting can start earlier)
Requested: 3 Oct 2026

## Why

Every code issue from 04 to 12 needs values that no ADR or `CONTEXT.md` defines today. Agents must not invent them (`docs/agents/domain.md`). This issue gets the user's decision on each one and records it as **ADR 0092** plus glossary entries.

## Decisions needed

The proposals below are drafts for the user to accept or change. They are **not** policy until ADR 0092 is accepted.

| # | Question | Proposal | Reasoning |
|---|---|---|---|
| D1 | Extended Stay length | 28–180 consecutive nights | Four weeks to six months; counsel (issue 02, Q3) may lower the maximum |
| D2 | What happens to 15–27 nights? | Unsupported at first (Short Stay remains 1–14) | Keeps ADR 0023 untouched; revisit with pilot data |
| D3 | Billing Period | 30 nights from check-in; the final period may be shorter | Simple and predictable; avoids calendar-month edge cases |
| D4 | First period | Paid through the existing Payment Window to confirm the Reservation and block the whole stay | Reuses ADRs 0044, 0046, 0088, 0090 |
| D5 | When later periods are due | 7 days before the period starts, with reminders at 7, 3 and 1 days | Time to pay, and time for the back office to act |
| D6 | Missed period payment | Human contact first. If still unpaid at period start, the stay ends at the end of the last paid night, following counsel's process (issue 02, Q2). Never a lockout | Lawful and humane; counsel decides the details |
| D7 | Cancellation before check-in | New catalogue entry "Extended": 100% of the first period's Cancellation Base refunded at T-14d and 50% at T-7d, otherwise retained; later periods are never charged | Mirrors ADR 0058 Standard; needs counsel approval |
| D8 | Notice to End after check-in | 14 days' notice. The guest pays through the end of the notice; paid nights after it are refunded at nightly contracted value | Fair for a changed assignment; protects owner income |
| D9 | Deposit | Zero in the pilot (ADR 0089); revisit after the pilot | Keeps one payment per period |
| D10 | Owner Payable per period | Period 1 due under ADR 0089 (24h after Verified Access). Later periods due when that Period Payment is verified and the period has started, with no Blocking Fulfilment Complaint open | The owner is paid as the guest pays |
| D11 | Utilities and servicing | Each unit states what is included (power and generator fuel, water, internet, cleaning frequency) inside the all-in price; no metered extras in the pilot | ADR 0015 forbids late mandatory charges |
| D12 | Nightly contracted value | The period amount divided by the nights in the period (the remainder goes to the last night) | Needed by ADR 0061 remedies and the Cancellation Base |
| D13 | Extension | A Booking Amendment adding whole Billing Periods, still within D1 | ADR 0060 |
| D14 | Units | A unit offers Extended Stays only when it opts in and has Monthly Agreed Amounts, a utilities statement and a cleaning schedule | Owner control; no surprise long bookings |

## Acceptance criteria

- AC1: `docs/adr/0092-offer-extended-stays.md` is written in the house style and records D1–D14 as decided, along with what it amends:
  - ADR 0023 stays in force for Short Stays;
  - ADR 0058 gains an Extended catalogue entry and the early-departure rule for Extended Stays;
  - ADR 0089 gains the per-period payable rule.
- AC2: `domains/shortlet/CONTEXT.md` gains glossary entries in the existing format (term, definition, _Avoid_): **Extended Stay, Billing Period, Period Payment, Period Owner Payable, Notice to End, Monthly Agreed Amounts**. The Short Stay entry links to Extended Stay.
- AC3: Every value that issues 04–12 need traces to ADR 0092 or `CONTEXT.md`. Any gap is listed under `## Comments` and sent back to the user.
- AC4: Counsel's answers from issue 02 are reflected, or the ADR says which items await counsel and which issues stay blocked.

## Comments

- 4 Oct 2026: Draft written at `docs/adr/0092-offer-extended-stays.md` (status `proposed`). It includes D1–D14 marked **[decide]** or **[counsel]**, the proposed glossary entries, and the status of earlier ADRs. Three values were added while drafting and also need the user's decision:
  - a shorter final period is priced pro rata by night;
  - a later period becomes payable once the previous period has started;
  - a unit may raise, but not lower, the minimum Extended Stay length.
  Glossary entries are not yet in `CONTEXT.md`; they are added when the ADR is accepted.

## Answer

Decided by the user on 4 Oct 2026. `docs/adr/0092-offer-extended-stays.md` is **accepted except the items marked [counsel]**. The glossary entries are added to `domains/shortlet/CONTEXT.md`.

| # | Decision |
|---|---|
| D1 | Extended Stay is **30–90 nights** (changed from 28–180; starting at 30 means the first period is always a full monthly period). Counsel may lower the maximum. |
| D2 | **15–29 nights are not offered**; revisit after the pilot. |
| D3 | **30-night Billing Periods** from check-in; the last may be shorter. |
| — | A shorter final period is priced at the **owner's nightly rate plus margin**, with no monthly discount (changed from pro rata). |
| D4 | First period paid through the existing payment flow confirms the stay and blocks every night. |
| D5 | Later periods are **payable once the previous period starts**, **due 7 days before** their first night, with **reminders at 7, 3 and 1 days**. |
| D6 | Missed payment: human contact first; no lockout; the lawful process is **[counsel]**. |
| D7 | Extended cancellation entry: **100% at T-30d, 50% at T-14d** of the first period's Cancellation Base (changed from T-14d/T-7d); thresholds need counsel's approval. |
| D8 | **Notice to End is 14 days**; needs counsel's approval. |
| D9 | **Zero deposit** in the pilot; revisit. |
| D10 | A later period's owner payable is due when **paid and started**, with no Blocking Fulfilment Complaint open. |
| D11 | **Utilities all included**, no metered extras. |
| D12 | Nightly contracted value: a full period ÷ 30 (remainder to the last night); a short final period uses its nightly prices. |
| D13 | Extensions add Billing Periods through a Booking Amendment, within 90 nights. |
| D14 | Units opt in and may **raise the minimum only** (30–90). |

**Still open (counsel, issue 02):**
1. Whether the 90-night maximum is safe as a licence to occupy.
2. The process for a missed payment.
3. Approval of the cancellation thresholds and the notice period.
4. Licence-to-occupy contract wording.
5. Receipt fields and tax.

Issues 04, 05, 07, 09, 11 and 12 can proceed. Issues 06 and 08 can be built, but the guest-facing behaviour that depends on the counsel items must stay off until counsel answers. Issue 10 stays blocked by 02.
