# Structured request and assistant logging on the Worker

Status: ready-for-agent
Type: AFK
Blocked by: none
Requested: 8 Nov 2026
Wraps: [pilot-launch-readiness/24](../../pilot-launch-readiness/issues/24-structured-logging.md)

## Parent

[PRD](../PRD.md). Should-have: the dry run (issue 20) needs logs to debrief from.

## Why

Pilot 24 says the pilot logs nothing per request and assistant diagnostics go nowhere. Since then the Worker gained closed payment log lines (`payment_continuation_rejected`, `card_checkout_failed`) and an OTel GenAI turn record (4f6acce). Check what remains before building.

## What to do

- Write in Comments which pilot 24 criteria main already meets on the Worker, with evidence.
- Build only the missing parts: one JSON line per request (route template, status, latency, request id; no body, no query values), assistant diagnostics (provider, model, latency, status, error class; no prompt or reply text), unhandled rejections.

## Acceptance criteria

- [ ] AC1 to AC3: the three criteria of pilot 24, met on the Worker, one named test each.
- [ ] AC4 failure path: a request carrying a cookie, token, phone or email produces a log line with none of them (tested).

## ADRs to read

0075, 0079, 0106.

## Comments
