# Operator replies from the inbox, and message emails

Status: ready-for-agent
Type: task
Blocked by: 08
Requested: 2 Oct 2026

## Why

User stories 9 and 10: the Operator works from the inbox they already use, and each side learns by email that the other has written.

## What to build

- In `apps/local-owner`: a "Messages" view next to the Booking Request inbox (`local-owner-server.ts`), listing threads for the Operator's bookings with unread counts, and a thread page with a plain POST reply form. Authority from the ADR 0082 grant.
- The Operator sees the Primary Guest's first name and the booking reference only; no Guest contact details (ADR 0011 minimization, ADR 0094).
- New `NotificationKind`s in `apps/pilot/src/notifications/pilot-notifier.ts`: `operator.message_received` (to the response-coverage contacts, ADR 0042) and `guest.message_received` (to the account email). The email says a message arrived and links to the thread; whether it includes the text follows ADR 0094.
- Notifications are batched or throttled per thread as ADR 0094 says, so a burst of messages does not send a burst of emails.

## Acceptance criteria

- AC1: An Operator with a grant sees threads for their bookings only and can reply. Failure path: another Operator's thread is not listed and a reply POST is refused.
- AC2: A Guest message records one `operator.message_received` notification; an Operator reply records one `guest.message_received`.
- AC3: The Operator's views contain no Guest phone number or email.
- AC4: A revoked grant cannot read or reply.

## Tests to add/update

New `test/operator-stay-messages.test.ts`; extend the notifier tests.

## ADR compliance

0011, 0042, 0072, 0075, 0082, 0086, 0094.
