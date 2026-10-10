# Flag an owner over-payment after a later cancellation

Status: resolved
Type: follow-up
Blocked by: none
Found in: B7 review (28 Sept 2026)

## Problem

A payout recorded while the payable was due can later exceed what the owner is owed. Nothing shows this.

In `projectOwnerPayable` (`domains/shortlet/src/owner-payable.ts`):
- after a cancellation, `ownerShareAfterCancellation` reduces `ownerPayableKobo` pro rata to what the policy kept;
- `outstandingKobo = Math.max(0, owed - paidKobo)` clamps at zero;
- status is then `paid`, or `nothing_owed` if the policy kept nothing.

Example: you pay the full ₦200,000 payable. The booking is then cancelled and the policy leaves the owner ₦80,000. The page shows the booking as "paid" with nothing outstanding. The ₦120,000 you paid over the new payable is invisible, both on the booking and in the owner's totals (AC2 of issue 07).

`recordOwnerPayout` correctly refuses paying more than is due at the time of payment. The gap is only in what happens after a later cancellation.

## Decision (28 Sept 2026)

- **Flag it and record the recovery.** An over-paid booking shows "Over-paid" with the amount instead of "Paid". The owner's totals show it separately, and Home lists it as waiting on you.
  - You recover the money off-platform, by asking the owner, then record the recovery with its date, amount and reference, the way payouts are recorded. A full recovery clears the flag.
  - The platform records facts only. No set-off or recovery rule is invented: ADR 0025's negative-balance recovery is superseded by ADR 0089 for launch.
- **Don't hold other payouts; warn.** The owner's other due payables can still be paid. Their payout form warns with the unrecovered amount.
- **Term.** The new term "Owner Overpayment" is added to `domains/shortlet/CONTEXT.md`.
- **Reachability.** Today only a later operator-failure or legal-override refund can cause one: the upheld-complaint path, issue 14. The flag is in place before that flow lands.

## Acceptance criteria

- AC1: When recorded payouts exceed the owner payable after a cancellation policy outcome, the booking shows "Over-paid" (not "Paid") and the amount over-paid (ADR 0089, 0014).
- AC2: The owner's totals show the over-paid amount separately. "Paid" is net of recoveries, and over-paid money is never counted as due now.
- AC3: Home lists each over-paid booking as waiting on you until it is fully recovered.
- AC4: You can record a recovery with its date, amount and reference, and a full recovery clears the flag. Recording one when nothing is over-paid, for more than is over-paid, with a reference already used for another amount, or from a stale version is refused. The standard failure paths apply (ADR 0072, 0075, 0082, 0086).
- AC5: While an owner has an unrecovered Owner Overpayment, their other due payables can still be paid, and the payout form warns with the amount.

## ADRs

| ADR | Constraint |
|---|---|
| 0089 | The owner payable comes from the snapshot and changes only with the cancellation policy outcome |
| 0014 | Cancellation policy outcome |
| 0077 | Projections are computed on read, not recalculated state |
| 0075 | No owner bank details in logs |

## Answer

Delivered on `bo/b11-flag-owner-overpayment`, stacked on `bo/b10-dismiss-blocking-complaint`. The tests are in `test/back-office-owner-overpayment.test.ts`, one per AC.

- **Domain** (`owner-payable.ts`):
  - A new status, `overpaid`. The projection gains `recoveredKobo`, `overpaidKobo` and `recoveries`. Payouts net of recoveries above the owner payable are an Owner Overpayment.
  - `recordOwnerRecovery` with `OwnerRecoveryError`. It refuses a recovery when nothing is over-paid, one for more than is over-paid, a reference already used with a different amount or date, and a stale version. An identical replay records nothing.
  - A new SQLite table, `owner_payout_recoveries`. A payout is refused while a booking is over-paid.
- **Environment:** `recordOwnerRecovery`. The audit keeps ids, the amount and the date; never the reference.
- **Back office:**
  - An over-paid card shows "Over-paid", the amount and any recoveries, plus a "Record a recovery" form (POST `/operator/payouts/<id>/recovery`).
  - Owner totals: "Paid" is net of recoveries, and "Over-paid" appears only when it is above zero.
  - Home lists "Owner over-payment to recover" from when the cancellation outcome was posted.
  - The owner's other due payout forms warn with the amount, but nothing is held.
- **Glossary:** `domains/shortlet/CONTEXT.md` gains the term "Owner Overpayment".
- **Test fixtures:** the Payouts-page helpers moved to `test/helpers/back-office-payouts.ts`, shared with the B7 tests. `payableRow` now ends at the card's `</article></li>`.
- **Walkthrough** (`.scratch/operator-dashboard/walkthrough-b11.ts`):
  - no horizontal overflow at 320, 375 or 1280 px, and no scripts on the page;
  - Home, the card, the totals and the warning all showed the over-payment;
  - after a full recovery from the page, the booking read "Paid", "Paid" was net of the recovery, and the flag and the warning were gone.
- **Checks:** `npm run check` is clean. The full `npm test` passed with 0 failures (1,125 and 123 tests). One earlier run had a single RB5 failure unrelated to this change; it is recorded on issue 12.
