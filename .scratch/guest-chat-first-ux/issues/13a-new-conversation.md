# New conversation without losing committed work

Status: ready-for-agent
Type: task
Blocked by: 09
Parent: [13](13-thread-control.md)

## What to build

Add a "New conversation" control. It starts a new thread (the thread id lives in sessionStorage, `client.ts:56`) without the fixture-only `/api/reset` (`guest-server.ts:2297`). When a request is live, confirm in the page first and say the request is unaffected.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC1: Starting a new conversation doesn't withdraw or cancel an existing Booking Request, and says so.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0079 | Starting over never cancels committed work |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.
