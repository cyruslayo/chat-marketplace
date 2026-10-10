# Guardrails: rate limits, body limits, session lifecycle and errors

Status: resolved
Type: task
Blocked by: 18

## What to build

Nothing rate-limits chat turns (up to five model calls each), new guest sessions, or `/operator/login`. `readJsonBody`, the operator login form and the Paystack webhook read unbounded bodies. Every guest session keeps its own `LocalGuestEnvironment`, SQLite connection and `AssistantRuntime` forever in `sessionRuntimes` (`apps/local-guest/src/guest-server.ts:3249`). `/api/turn` returns raw `error.message` on 500.

Limits are configuration, not magic numbers (AGENTS.md anti-pattern 3). When the daily model-call cap is reached, the concierge degrades to deterministic behaviour and conventional routes stay usable (ADR 0080). Keep principal isolation (ADR 0070, 0075).

## Acceptance criteria

- [x] Chat turns are rate-limited per session and per client address.
- [x] New guest sessions and operator login attempts are rate-limited per client address.
- [x] A daily model-call cap degrades the concierge to deterministic replies instead of erroring.
- [x] JSON bodies, the operator login form and the webhook body are size-limited.
- [x] Idle session runtimes are closed and evicted.
- [x] `/api/turn` 500 responses carry a generic message.

## Answer

Implemented on branch `launch/guardrails-and-notifications` (stacked on `launch/staging-and-build`).

- `apps/pilot/src/rate-limiter.ts`: `SlidingWindowRateLimiter`. The pilot front server (`requestGuard` in `pilot-server.ts`) limits chat turns (`POST /api/turn`, `POST /conversation`) per session and per address, new Guest sessions (`GET /` without a cookie) per address, and `POST /operator/login` per address. The address is the rightmost `X-Forwarded-For` entry from the loopback proxy. Both turn limits are checked before either is charged, so refusals cost nothing. Response is 429 with `Retry-After`.
- `apps/local-guest/src/assistant/model-call-budget.ts`: `ModelCallBudget` (resets at Lagos midnight) plus `BudgetedModelClient`. `LocalGuestApp` routes to the deterministic concierge once the cap is spent (ADR 0080).
- Body limits: `readJsonBody` 64 KiB, `readRawBody` (webhook and callbacks) 256 KiB, Operator login 4 KiB via the existing `readForm`. `BodyTooLargeError` gives 413.
- Session runtimes carry `lastUsedMs`; idle ones are closed and evicted on the next session lookup. `activeSessionRuntimes` is exposed on the handle.
- `/api/turn` 500 is generic; malformed JSON is 400.
- Configuration and defaults in `pilotLimits` (`PILOT_LIMIT_DEFAULTS`), documented in `docs/pilot-deployment.md`.
- Tests: `test/pilot-guardrails.test.ts`, one per criterion. The fixture was extracted to `test/helpers/pilot-fixture.ts`.
- **Confirmed by the user on 28 Sept 2026 ("keep the defaults"):** the default values (60 turns/session/h, 600 turns/address/h, 120 new sessions/address/h, 10 logins/address/h, 3000 model calls/day, 30-minute idle) are operational choices, not ADR policy. Carrier-grade NAT in Nigeria means per-address limits need review before a public campaign.
