---
status: accepted
---

# Record Verified Access from the back office as platform support

## Context

Under ADR 0089, the platform lists and manages every unit and pays each owner the agreed amount. Owners do not use the platform. The people who sign in to the back office (ADR 0086) are the platform's own staff. Each holds representative grants (ADR 0082) for the owners whose units they manage.

The owner payable becomes due 24 hours after Verified Access, provided no Blocking Fulfilment Complaint is open (ADR 0089). Someone must therefore be able to record Verified Access, and to report a Blocking Fulfilment Complaint, from the back office.

ADR 0022 accepts "documented platform-support verification" as evidence of Verified Access. It also says an operator declaration can never trigger revenue by itself. The check-in domain enforces this:
- support verification requires an `authorized_staff`, `admin` or `system` principal;
- an `operator` principal can only record an uncorroborated assertion.

Back-office sessions resolve to an `operator` principal, so today nobody in the back office can record Verified Access.

## Decision

A signed-in back-office user records check-in as **platform support**, not as the owner.

- **Role.** For the check-in commands only, the back office acts under an `authorized_staff` principal for the signed-in actor and tenant. The session itself stays an operator session (ADR 0086). No new role is introduced.
- **Scope.** The command is allowed only when the actor holds an active ADR 0082 grant for the Reservation's owner. The grant is checked on every command, and a missing, revoked or expired grant fails closed. The grant scopes *which* Reservations the user may act on; it does not make the user the owner's declarant.
- **Evidence.** Recording Verified Access requires the user to choose one documented basis from a fixed list:
  - "The Guest confirmed access to me directly";
  - "I or platform staff handed over access at the unit".

  There is no free text (ADR 0075). The basis code is kept with the evidence record.
- **What does not count.** The owner's or the owner's staff's word alone is an operator declaration (ADR 0022). It is not a basis, and the form says so.
- **Timing.** Verified Access cannot be recorded before the Reservation's Contractual Check-In Window begins (ADR 0022, ADR 0031), and cannot be recorded twice. The protection window starts at the later of contractual check-in and access provision (ADR 0022).
- **Complaints.** The same user may report a Blocking Fulfilment Complaint from a fixed category list, with no free text. While it is open, the owner payable is not due (ADR 0089).
- **Dismissing a complaint** (added 28 Sept 2026, back-office issue 10). The same user may dismiss an open complaint that did not hold up, choosing one fixed reason: "Fixed, and the Guest stayed" or "Not borne out on review". There is no free text, and the grant is checked as for reporting.
  - An upheld complaint is not dismissed. It stays open until a cancellation or remedy outcome is recorded, since under ADR 0089 only that outcome changes the owner payable.
  - Once no complaint is open, the owner payable is due 24 hours after Verified Access, or at the dismissal if that is later. Dismissing does not restart the protection window.
- **Upholding a complaint** (added 28 Sept 2026, back-office issue 14). The same user may uphold an open complaint by choosing the first night the failure affected. The stay ends from that night.
  - **Refund only in the pilot.** Relocation (ADR 0028, 0029) needs the Guest Protection Fund, which is out of launch scope (ADR 0089).
  - **The Guest's refund follows ADR 0061:** 100% of the contracted nightly price for each night from the first affected night to checkout. When the first night is affected, everything paid is refunded. Once a night was used, mandatory charges count as delivered; this is the pilot reading of "attributable undelivered charges".
  - **The owner payable.** The outcome is posted as the booking's cancellation outcome, so the owner payable is the owner's share of what is kept, due at once (ADR 0089). A payout already above it is an Owner Overpayment.
  - **Paying the refund.** You refund the Guest from the Paystack dashboard or by bank transfer, then record it with its date, amount and reference. There is no automated refund.
  - **One per stay.** A stay has one upheld outcome, and its dates are not released automatically.
- **Audit.** Each record keeps only the actor, Reservation, basis or category code, status transition and time (ADR 0075).

## Status of earlier decisions

- **ADR 0022:** unchanged. This decision names who performs "documented platform-support verification" in the back office.
- **ADR 0082:** unchanged. Grants still govern owner scope; the `operator_actions` permission is not stretched to cover check-in, which runs as platform support.
- **ADR 0086:** unchanged. Sessions still carry only actor and tenant.

## Consequences

- One person can both manage an owner's units and verify check-in for them. This is acceptable for the pilot because owners never use the platform (ADR 0089). If owners ever get their own accounts, check-in verification must move to staff who are not the owner's representative.
- A human fulfilment review (ADR 0022) is still needed for conflicting evidence. The back office shows that state, but does not resolve it.
