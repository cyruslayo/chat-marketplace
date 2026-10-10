# Structured logging and assistant diagnostics

Status: ready-for-agent
Type: task
Blocked by: 18

## What to build

The pilot logs nothing at runtime, and `AssistantRuntime` `onDiagnostic` events go nowhere. Emit one JSON line per request and wire assistant diagnostics, with no bodies, prompts, keys or PII (ADR 0075, 0079).

## Acceptance criteria

- [ ] Each request logs route, status, latency and a request id, and no body or query values.
- [ ] Assistant diagnostics log provider, model, latency, status and error class, and no prompt or reply text.
- [ ] Unhandled rejections are logged.
