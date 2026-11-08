# Structured logging and assistant diagnostics

Status: resolved
Type: task
Blocked by: 18

## What to build

The pilot logs nothing at runtime, and `AssistantRuntime` `onDiagnostic` events go nowhere. Emit one JSON line per request and wire assistant diagnostics, with no bodies, prompts, keys or PII (ADR 0075, 0079).

## Acceptance criteria

- [x] Each request logs route, status, latency and a request id, and no body or query values.
- [x] Assistant diagnostics log provider, model, latency, status and error class, and no prompt or reply text.
- [x] Unhandled rejections are logged.

## Comments

- 2026-11-08 (agent): Resolved on the Worker by [production-launch/10](../production-launch/issues/10-request-and-assistant-logging.md) at commit `7793c01`. The per-request line is `http_request` in `apps/cloudflare/src/worker.ts`; the provider was added to the existing `assistant.turn.v1` record; `unhandled_rejection` logs the error class only. Tests: 4/4 `apps/cloudflare/test/pilot-logging.spec.ts`, 12/12 `test/assistant-turn-record.test.ts`.
