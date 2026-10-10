# Record an upheld complaint's outcome from the back office

Status: resolved
Type: follow-up
Blocked by: 10
Found in: deciding issue 10 (28 Sept 2026)

## Problem

Issue 10 lets the back office dismiss a Blocking Fulfilment Complaint that did not hold up. An **upheld** complaint, where the stay failed, stays open, and the owner payable stays paused.

- ADR 0089: the owner payable changes only through the booking's cancellation policy outcome.
- ADR 0028: for an operator failure, the Guest chooses a relocation or a full refund.

The back office cannot record either today. `projectOwnerPayable` already follows a posted cancellation outcome (`owner_payable_cancellations`), so once a cancellation is recorded the payable resolves by itself.

## Decision (28 Sept 2026)

- **Refund only.** An upheld complaint ends the stay with a refund. Relocation is out of pilot scope, because the Guest Protection Fund that pays for it is out of launch scope (ADR 0089, 0027). ADR 0028 makes a refund the default when no comparable place can be arranged.
- **The amount is the unused nights (ADR 0061).** You pick the first affected night:
  - the Guest gets 100% of each night's contracted nightly price from that night through checkout;
  - if the first night is affected (no night used), the whole amount paid is refunded;
  - the owner keeps their share of the nights enjoyed.
- **You pay the refund, then record it.** The back office shows "Refund owed to the Guest". You refund from the Paystack dashboard or by bank transfer, then record it with its date, amount and reference, like a payout. There is no Paystack Refund API integration.
- **Who:** any back-office user, acting as platform support with the grant for the owner checked on every action (ADR 0091).

### Choices made within these

- **Mandatory charges.** Cleaning and service charges are refunded only when no night was used; once the Guest has stayed they count as delivered. ADR 0061 says "attributable undelivered charges", and this is the pilot reading of it. Flagged to the user.
- **Dates stay held.** Upholding does not release the stay's remaining dates. A unit with a safety or habitability failure should not reappear for booking automatically.
- **Owner payable.** The outcome is posted to the cancellation ledger. The owner payable is then the owner's pro-rata share of what the platform keeps, due at once (ADR 0089, as issue 07's cancellation rule). A payout already made above it shows as an Owner Overpayment (issue 11).

## Acceptance criteria

- AC1: From the Reservation page you can uphold an open Blocking Fulfilment Complaint by choosing the first affected night from the stay's nights. The complaint closes as upheld, and the Guest's refund is fixed: 100% of the nightly price for each night from the first affected night to checkout, or the whole amount paid when the first night is affected (ADR 0061, 0028).
- AC2: Upholding posts the outcome as the booking's cancellation outcome. The owner payable becomes the owner's share of what is kept, due at once, and a payout already above it shows as an Owner Overpayment (ADR 0089).
- AC3: The Reservation page and Home show the refund owed to the Guest until it is fully recorded. You record it with its date, amount and reference. Recording more than is owed, when nothing is owed, with a reference already used for another amount, or from a stale version is refused (ADR 0072, 0075).
- AC4: Upholding is refused for a complaint that is already closed, for a night outside the stay, for a stay an earlier outcome already ended, or from a stale version. The standard failure paths apply (ADR 0082, 0086).

## ADRs

| ADR | Constraint |
|---|---|
| 0089 | The owner payable changes only through the cancellation policy outcome |
| 0028, 0029 | The Guest chooses relocation or refund, within bounds |
| 0014, 0058 | Cancellation catalogue and liability |
| 0027 | Guest Protection Fund |

## Answer

Delivered on `bo/b14-uphold-complaint-refund`, stacked on `bo/b11-flag-owner-overpayment`. The tests are in `test/back-office-uphold-complaint.test.ts`, one per AC.

- **Domain:**
  - `CheckInSupportManager.upholdBlockingComplaintAsSupport`: one upheld outcome per stay. The complaint closes with resolution `upheld` and keeps `upheldFromNight`.
  - `owner-payable.ts`:
    - `upheldStayRefund` applies the ADR 0061 amount; a night outside the stay is refused.
    - `GuestRefund`, `recordGuestRefund` and `GuestRefundError`, with a `guest_refunds` table in the same SQLite ledger. A Guest refund is replay-safe per reference and never more than is still owed.
    - The projection gains `cancellationLiability`.
- **Environment:**
  - `upholdBlockingComplaint` goes through `#checkInCommand`: grant, version and an `authorized_staff` principal. It posts the outcome to the cancellation ledger with liability `operator_failure`, and the retained Cancellation Base is the base minus the refund.
  - `recordGuestRefund` and `listGuestRefundsOwed`.
  - `OperatorReservation.stayOutcome`. `ownerPayableDueAt` is the time the outcome was posted.
- **Back office:**
  - Under each open complaint: "Uphold this complaint…", offering the stay's nights, with the first night marked as a full refund.
  - The Reservation page shows the upheld outcome, "Refund owed to the Guest", the refunds recorded, "Still to refund" or "Refunded in full", and a "Record the Guest's refund" form (POST `/operator/bookings/<id>/guest-refund`).
  - Home adds a "Refund owed to the Guest" item.
  - The Payouts card reads "Ended by an upheld Blocking Fulfilment Complaint".
- **ADR 0091** has a dated "Upholding a complaint" item recording the decision.
- **Walkthrough** (`.scratch/operator-dashboard/walkthrough-b14.ts`):
  - Upholding from the second night of a three-night stay fixed a refund of ₦240,000, two nights at ₦120,000.
  - The owner payable became due when the outcome was recorded, and Home listed the refund.
  - Recording ₦240,000 read "Refunded in full" and cleared the Home item.
  - No horizontal overflow at 320, 375 or 1280 px, and no scripts on the page. Screenshots were unavailable because the app window was behind another window, so this was checked from the page's content.

### Open points, surfaced to the user

- **Mandatory charges:** once a night was used, they count as delivered; see the decision above. ADR 0061's "attributable undelivered charges" may deserve a firmer rule before paid launch.
- **The stay's dates stay held after an upheld outcome.** Reopening them is left to a human.
- **The Bookings list still shows the Reservation as confirmed.** The ended state appears on the Reservation page and in Payouts, but B4's stage projection does not read the upheld outcome.

