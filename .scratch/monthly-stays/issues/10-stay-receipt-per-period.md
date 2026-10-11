# Stay receipt for each Billing Period

Status: needs-info
Type: task
Blocked by: 02, 06

## Why

Segment 1 books and pays personally, then claims the cost back from an employer. Without a receipt the employer accepts, they won't book.

## What to build

- For each verified Period Payment (and for any Short Stay payment), generate a receipt from the ledger, never from typed values. The fields come exactly from issue 02's AC3 field list. Any tax line appears only if counsel requires it.
- The guest can open and download the receipt from the stay page and from chat. Both render from one helper (guest UI kit rules in AGENTS.md).
- Receipt numbers are unique and sequential per issuer, as counsel specifies.
- A refund produces a credit note or an updated receipt, as counsel specifies.
- No card numbers, account numbers, identity evidence or tokens appear on the receipt or in logs (ADR 0075).

## Acceptance criteria

- AC1: A verified Period Payment produces exactly one receipt whose fields and amounts match the ledger and the issue 02 field list.
- AC2: An unverified, failed or superseded payment produces no receipt.
- AC3: Only the Primary Guest of that booking can open the receipt. Another guest or a signed-out visitor is refused.
- AC4: A refund against a receipted payment produces the counsel-specified correction document.
- AC5: Receipts and their logs contain no payment credentials or identity evidence.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0075 | Data minimisation; no credentials in output or logs |
| 0089 | Ledger records amount received, owner payable and margin |
| 0006 | The receipt shows the platform as collection agent for the Accommodation Provider, as counsel words it |

## Definition of Done

See `docs/agents/issue-tracker.md`. Include captures at 320, 390, 768 and 1280 under `screenshots/10/`.

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: needs-info`. Reason: the acceptance criteria depend on counsel's answers, which are not recorded. Issue 02 (`02-legal-review-licence-and-receipts.md`) is still `Status: ready-for-human`, and its `## Answer` is not written. AC1 and AC3 here take the receipt field list and any tax line from issue 02 AC3. AC4 (credit note or corrected receipt) depends on counsel too. Issue 06 (`06-billing-periods-and-period-payments.md`, still `ready-for-agent`) defines the Billing Periods and Period Payments that AC1 and AC2 use. Blocked by lines are kept: 02, 06.
- Open question: what receipt fields, tax lines, numbering rule and refund correction document does counsel require (issue 02 AC3 and the "Receipts" question 5)? Until counsel answers, this issue cannot name the fields without inventing them.
- Reconciliation note (11 Oct 2026): status set from the reconciliation on origin/main 37b9c62. Not re-checked: the Definition of Done and the 320/390/768/1280 captions named in this file.
