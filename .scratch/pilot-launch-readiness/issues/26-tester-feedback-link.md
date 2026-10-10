# Tester feedback link

Status: ready-for-agent
Type: task
Blocked by: none

## What to build

Beta testers need a way to report problems from inside the app. Add a "Report a problem" link on every guest page leading to a conventional form (ADR 0080). Submissions are stored in SQLite and listed in the back office. Store only what the guest types plus the page they came from.

## Acceptance criteria

- [ ] Every guest page links to the feedback form.
- [ ] A submitted report is stored and listed in the back office.
- [ ] Empty or oversized reports are rejected with a message.
