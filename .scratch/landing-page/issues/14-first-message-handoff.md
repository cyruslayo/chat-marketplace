# 14 · Carry the landing search box message into a new conversation

Status: ready-for-agent
Type: task
Blocked by: 11, 13 (decision 1 must be (a); if the owner picks (b), close this as wontfix and change the copy under 13 instead)
Requested: 20 Oct 2026

## What to build

The direction doc's "Landing-to-concierge handoff", with the details as they are on `main`:

- The hero and closing composers `POST` to a landing-owned route (for example `POST /welcome/start`), with the message in the body as a named field. The page never uses a GET form with a named field, so the message never appears in a URL, the history or the logs.
- The route:
  - applies the same session issuance and beta-invite gate as `GET /`;
  - if the visitor already has an active conversation, offers "Continue your conversation" first, following `GUEST_NEW_CONVERSATION` / ADR-0079. Starting a new one never withdraws existing work.
  - otherwise starts a new thread whose **first Guest message is exactly the text typed**, runs the first concierge turn as `POST /conversation` does for a new thread, and redirects (303) to the conversation.
- Only the text typed is carried. No default dates, guests or budget are invented.
- Sending is a discovery action. It never creates a Draft, Booking Request, hold, Reservation or payment attempt.
- If the concierge fails, the message is kept and the guest can retry. An empty or over-long message is rejected with the composer's own validation, and the text is kept.
- Rate limits and body limits follow the existing guardrails (pilot-launch-readiness 19).
- No JavaScript is required, and the example chips still only fill the field.

## Acceptance criteria

1. Sending from the hero or the closing composer opens a conversation whose first Guest message is the text typed, followed by the concierge's reply
2. The typed text never appears in any URL, redirect location or log line
3. A visitor with an active conversation is offered to continue it first, and starting a new one leaves the existing work untouched
4. With the beta invite gate on, sending meets the gate exactly as `/` does, and the text survives the gate
5. Sending creates no Draft, Booking Request, hold, Reservation or payment attempt

## Rules

- AGENTS.md protocol, with an ADR table: 0005, 0077, 0078, 0079, 0080 (deterministic parity for the critical workflow), 0075 (no bearer credentials in logs), plus the guardrail ADRs.
- Confirm the seam with the application owner before coding (direction doc, human decision 6). Record the confirmation in `## Comments`.
- Run `npm run check`, the landing tests and the guest app's conversation tests, then `npm test` once in the background, then `npm run test:workers`.

## Comments
