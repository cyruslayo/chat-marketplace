# Deterministic path reads "today" in an unrelated message as a check-in date

Status: needs-triage
Type: AFK
Blocked by: none
Requested: 3 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

Found by the parity suite (issue 16). On the deterministic path, an unrelated message that contains a relative date word such as "today" is read as a check-in date and replaces the held criteria with "27 Oct 2026 (to confirm)". The assistant path keeps the criteria. ADR 0080 requires parity.

## What to build

Make deterministic fact extraction ignore a relative date word that is not part of a stay request, so held criteria are kept. Add a parity row that uses such a message.

## Acceptance criteria

- [ ] AC1: an unrelated message containing "today" keeps the held criteria on the deterministic path.
- [ ] AC2: the parity suite has a row for it, passing on both paths.

## Comments

Raised by the owner-approved decision on issue 16 (3 Nov 2026): file separately, do not fix inside 16. Care needed: existing deterministic tests (guest-real-dates, guest-must-fix-ux) depend on current extraction.
