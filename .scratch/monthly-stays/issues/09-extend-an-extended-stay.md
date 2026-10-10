# Extend an Extended Stay

Status: ready-for-agent
Type: task
Blocked by: 06

## What to build

The guest can add Billing Periods (the last may be shorter, priced per night) to a confirmed Extended Stay through a Booking Amendment (ADR 0060, ADR 0092 "Extensions").

- Check availability for the added nights, a fresh quote at the current Monthly Agreed Amounts, Request to Book approval, and validity of inspection and authority through the new checkout (ADR 0056, ADR 0057).
- The total length must stay within the Extended Stay range. Adding periods appends new Billing Periods and Period Owner Payables. Existing periods are never repriced.
- Extensions cannot be agreed in chat or arranged off-platform (ADR 0023).

## Acceptance criteria

- AC1: An extension request with available nights, operator approval and valid inspection and authority commits as a Booking Amendment that appends priced periods.
- AC2: An extension that would exceed the Extended Stay maximum is rejected before quoting.
- AC3: An extension whose new checkout falls after inspection or authority expiry is rejected.
- AC4: If any night in the extension is unavailable, the extension is rejected and the original contract is unchanged.
- AC5: Existing periods, their amounts and their payables are unchanged by an extension.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0092 | 30–90 nights; "Extensions" |
| 0060 | Versioned amendment, atomic |
| 0023 | No informal extensions |
| 0056, 0057 | Validity through the new checkout |
| 0015 | Fresh quote |

## Definition of Done

See `docs/agents/issue-tracker.md`.

## Comments
