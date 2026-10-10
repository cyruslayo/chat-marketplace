# Operator and guest notifications

Status: resolved
Type: task
Blocked by: none

## What to build

No notification provider is implemented (`packages/platform-core/src/provider-contracts.ts` has interfaces only). Operators have a limited response window (ADR 0041, 0043) but are not told when a Booking Request arrives, and guests get no confirmations. Implement the notification contract with an email provider. Message content carries no restricted identity or payment material (ADR 0075). The choice of email vendor is a human decision: ask before wiring one.

## Acceptance criteria

- [x] The Operator is notified when a Booking Request is disclosed.
- [x] The Operator is reminded before the response window closes.
- [x] The Guest is notified when a request is submitted, an offer is made, payment is confirmed, and a request expires or is declined.
- [x] A notification failure never changes booking state.

## Answer

Implemented on branch `launch/guardrails-and-notifications`. The user chose Resend (28 Sept 2026).

- `apps/pilot/src/notifications/email-sender.ts`: `ResendEmailSender` (raw fetch, `Idempotency-Key`, status-only errors).
- `apps/pilot/src/notifications/pilot-notifier.ts`: `PilotNotifier` sweeps the durable store every `SHORTLET_NOTIFICATION_SWEEP_SECONDS` (default 30) and records each send in `pilot_notifications`.
  - Operator: new delivered request, plus reminders at ADR 0041's 10 and 25 minutes.
  - Guest (when an email exists): submitted, offer made, payment confirmed, declined, expired, not delivered.
- `domains/shortlet/src/booking-request.ts`: pure `projectBookingRequestStatus` for lazy expiry without writes.
- Configuration: `RESEND_API_KEY`, `SHORTLET_NOTIFICATION_FROM` and `SHORTLET_OPERATOR_ALERT_EMAILS`, all or none. The banner shows `notifications=resend operatorAlertRecipients=N` or `notifications=disabled`.
- Tests: `test/pilot-notifications.test.ts`, one per criterion, plus sender, config and wiring tests.
- Delivery semantics are unchanged: the pilot's `autoDeliverRequests` already counts persistence to the back office as ADR 0043 acceptance.
- Not verified live: no real Resend call has been made. Set up a verified sending domain in Resend, then check a real request arrives.
- Operator alerts go to a configured ops list because `OperatorRecord` has no contact email, and the pilot has one founder-run Operator (audit finding P5). Per-Operator routing is future work.
