# Server-generated guest thread ids

Status: ready-for-agent
Type: AFK
Blocked by: none
Requested: 8 Nov 2026
Wraps: [shortlet-concierge-launch/53](../../shortlet-concierge-launch/issues/53-server-generate-guest-thread-ids.md)

## Parent

[PRD](../PRD.md). Should-have security hygiene before real guests.

## Why

A client can choose its own guest thread id today (any value matching `THREAD_ID_PATTERN`). That costs audit correlation and keeps `g-<uuid>` out of the platform-id redaction exemption. See issue 53 for the full analysis; note that line numbers there may have moved after the guest-focused-journey merge.

## What to build

Issue 53's "What to build" and acceptance criteria. Default: refuse a client-supplied id with 400 `INVALID_CONVERSATION`.

## Acceptance criteria

- [ ] AC1: issue 53's criteria, one named test each.
- [ ] AC2: the cold assistant journey (`test/assistant-cold-journey.test.ts`) still passes.

## ADRs to read

0074, 0075, 0106.

## Comments
