# Resolve a Blocking Fulfilment Complaint from the back office

Status: resolved
Type: follow-up
Blocked by: none
Found in: B7 review (28 Sept 2026)

## Problem

Once a Blocking Fulfilment Complaint is open, the owner payable stays paused forever. Nothing can close the complaint.

- B5 added `reportBlockingComplaint` (POST `/operator/bookings/<id>/blocking-complaint`). It calls `reportBlockingComplaintAsSupport` in `domains/shortlet/src/checkin-support.ts`, which creates a complaint with `status: "open"`.
- `BlockingFulfilmentComplaint.status` can be `"open" | "under_human_review" | "resolved"`, but no command moves a complaint to `resolved`. `hasUnresolvedBlockingComplaint` therefore stays true.
- B7's `projectOwnerPayable` (`domains/shortlet/src/owner-payable.ts`) returns `paused` and `dueAt: null` while a complaint is open. `recordOwnerPayout` then refuses with `paused`. The Payouts page counts the payable under "not yet due" (`local-owner-server.ts`, the "until the complaint is resolved" comment).

A complaint reported by mistake, or one that support has closed, keeps the owner unpaid, and there is no way out in the back office.

## Decision (28 Sept 2026)

- **Outcomes: dismiss only.** From the Reservation page you can close an open complaint that did not hold up. You pick one reason from a fixed list, with no free text (ADR 0075):
  - `cured`: "Fixed, and the Guest stayed";
  - `not_borne_out`: "Not borne out on review".

  An **upheld** complaint is not closed here. It stays open, and the payable stays paused, until a cancellation or remedy outcome is recorded. Under ADR 0089 that is the only thing that changes the owner payable, and B7 already follows a posted cancellation. The back-office flow for that is [14](14-record-an-upheld-complaint-outcome.md).
- **Due date: the later of the two times.** Once no complaint is open, the payable is due 24 hours after Verified Access (ADR 0089, read literally). If a complaint is dismissed after that point, the payable is due at the moment of dismissal. The protection window is not restarted.
- **Who: any back-office user.** They act as platform support, as with reporting (ADR 0091), with the grant for the owner checked on every action.

## Acceptance criteria

- AC1: From the Reservation page you can dismiss an open Blocking Fulfilment Complaint with a reason from the fixed list. The complaint becomes resolved, and the action is audited with codes only (ADR 0075, 0091).
- AC2: Once no complaint is open, the owner payable leaves "paused". It is due 24 hours after Verified Access, or at the dismissal if that is later (ADR 0089).
- AC3: Dismissing a complaint that is already resolved, or from a stale version, or with no or an unknown reason, is refused and changes nothing (ADR 0072).
- AC4: The standard back-office failure paths apply: a revoked or expired grant, no session, a cross-origin POST, and a stale target.

## ADRs

| ADR | Constraint |
|---|---|
| 0021 | Revenue is held while a Blocking Fulfilment Complaint is open |
| 0089 | The owner payable is due 24 hours after Verified Access with no complaint open |
| 0091 | Back-office complaint actions are recorded as platform support, using fixed categories and no free text |
| 0061, 0028 | Remedies when a complaint is upheld |
| 0072 | Idempotent, versioned commands |
| 0075 | No free text or contact details in audit records |

## Answer

Delivered on `bo/b10-dismiss-blocking-complaint`, stacked on `bo/b8a-retire-imported-blocks`. The tests are in `test/back-office-dismiss-complaint.test.ts`, one per AC.

- **Domain** (`checkin-support.ts`):
  - `dismissBlockingComplaintAsSupport` accepts only `authorized_staff`, `admin` or `system`, and only a reason from `COMPLAINT_DISMISSAL_REASONS`. An unknown or already-closed complaint is refused. The complaint keeps `resolvedAt` and `resolution`.
  - `lastComplaintResolvedAt`.
  - A category reported again after a dismissal gets a numbered complaint id (`…_2`), so ids never collide.
- **Owner payable** (`owner-payable.ts`): `projectOwnerPayable` takes `complaintResolvedAt`. With no complaint open, the payable is due at the later of 24 hours after Verified Access and the last dismissal.
- **Environment:** `dismissBlockingComplaint` goes through the same `#checkInCommand` as reporting: grant check, version check and an `authorized_staff` principal (ADR 0091). It adds `COMPLAINT_DISMISSAL_LABELS` and `CheckInRefusedError`. `OperatorReservation.openComplaints` now carries each complaint's `complaintId`.
- **Server:** POST `/operator/bookings/<id>/blocking-complaint/<complaintId>/dismiss`. The Reservation page shows a "Dismiss this complaint…" form under each open complaint. It explains that an upheld complaint stays open.
- **ADR 0091** has a dated "Dismissing a complaint" item recording the decision.
- **Test fixtures:** `test/helpers/back-office-reservation.ts` (`reservation`, `travelTo`, `cookieOf`, `recordAccess`, `openComplaint`, `windowOpens`, `principal`) is shared with the B7 tests.
- **Walkthrough** (`.scratch/operator-dashboard/walkthrough-b10.ts`):
  - no horizontal overflow at 320, 375 or 1280 px;
  - no scripts on the page;
  - after a dismissal from the page, the owner payable read "Due 11 Sept 2026, 14:30 WAT", 24 hours after Verified Access.
