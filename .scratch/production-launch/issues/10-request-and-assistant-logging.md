# Structured request and assistant logging on the Worker

Status: resolved
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

- [x] AC1 to AC3: the three criteria of pilot 24, met on the Worker, one named test each.
- [x] AC4 failure path: a request carrying a cookie, token, phone or email produces a log line with none of them (tested).

## ADRs to read

0075, 0079, 0106.

## Comments

- 2026-11-08 (agent): What main already met before this issue, with evidence: assistant diagnostics were partially met by the per-turn `assistant.turn.v1` record (`apps/local-guest/src/assistant/assistant-turn-record.ts`, commit 4f6acce), wired on the Worker at `apps/cloudflare/src/shortlet-pilot-do.ts:onAssistantTurn`. It carried the model (`gen_ai.request.model`), latency (`assistant.duration_ms`) and the closed status/error class (`assistant.control_outcome`, `assistant.failure_class`, `error.type`) and never carried prompt, reply, tool arguments or results. It did **not** carry the provider. Payment failure lines (`payment_continuation_rejected`, `card_checkout_failed`) were already closed-code lines (ADR 0075). Nothing logged per request, and nothing logged unhandled rejections.
- Built: `apps/cloudflare/src/worker.ts` now writes one `http_request` JSON line per request with a server-generated `request_id`, method, route template, status and `duration_ms`. Known dynamic routes collapse to templates and unknown paths redact UUID/long opaque segments, so no id or query value enters the line. Early refusals (commerce/internal 404, unprovisioned 503) are logged too. The router also logs `unhandled_rejection` with the error class only, never the message; registration happens on the first request.
- Built: `gen_ai.provider.name` was added to the turn record and threaded from `createGuestRequestHandler({ assistantModelProvider })` through every `AssistantRuntime` construction. The Worker passes `configuration.concierge.primary?.provider`; Node derives it from the loaded concierge configuration. No prompt, reply, tool arguments or results enter the record.
- Validation: `npm run check` clean. `npm run test:workers -- apps/cloudflare/test/pilot-logging.spec.ts` 4/4 (AC1 request line; AC2 provider/model/latency/status/error class and no text; AC3 unhandled rejection; AC4 cookie/token/phone/email absent). `npx tsx --test test/assistant-turn-record.test.ts` 12/12. The `test/assistant-turn-record-hosts.test.ts` host-contract assertion now checks the provider pass-through; its four live-host tests require `PAYSTACK_SECRET_KEY` from the caller's environment and were not run in this shell.
- Implementation commit `7793c01`.

## Answer

The Worker now logs one redacted JSON line per request (request id, method, route template, status, latency) and unhandled rejections by class, and the assistant turn record includes the configured provider alongside model, latency and the closed status/error class. No body, query value, header, cookie, prompt or reply text is logged. Wrapped issue pilot-launch-readiness/24 is resolved with this one.
