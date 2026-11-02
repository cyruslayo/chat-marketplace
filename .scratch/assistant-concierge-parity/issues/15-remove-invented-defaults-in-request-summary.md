# Bug: the request summary shows made-up nights and party size

Status: ready-for-agent
Type: AFK
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

`propose_request_to_book` builds its summary with `nights ?? 3` and `partySize ?? 1` (`shortlet-assistant-pack.ts:730`). If either is unknown, the guest is shown invented values, against the same file's rule "Never default to one" and ADR 0015 (no invented quote or party size).

## What to build

- The proposal requires known nights and party size (from the task state); if either is missing it is a `tool_denial` with the stay clarification, like `search_stays` (:415).
- The summary uses only known values.

## Acceptance criteria

- [ ] AC1: With nights and party known, the summary shows them.
- [ ] AC2 failure path: with nights unknown, no proposal is created and the stay clarification is returned.
- [ ] AC3 failure path: with party size unknown, the same.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0015 | No invented quote or party size | AC2, AC3 |
| 0106 | Rejected calls are `tool_denial` | AC2, AC3 |

## Comments
