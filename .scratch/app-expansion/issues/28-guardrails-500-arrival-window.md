# 28: The `/api/turn` 500 guardrail test had drifted out of the arrival window

Status: resolved
Type: task
Blocked by: none

## Defect

`test/pilot-guardrails.test.ts` `/api/turn 500 responses carry a generic message` failed at `985212b` and on the wave-2 gate: `200 !== 500` (`test/pilot-guardrails.test.ts:188`). The 200 body was not a degraded search reply. It was the deterministic concierge refusing the date:

```json
{"ok":true,"messages":["Arrival dates can be at most 90 days ahead, so the latest arrival is Wed 2 Dec 2026. Please choose an earlier date."]}
```

## Cause

The test opens its own `LocalGuestEnvironment`, whose default clock is fixed at `2026-09-03T10:00:00Z` (`apps/local-guest/src/fixture.ts:424`). Its arrival came from `arrivalNextWeek()`, which read the wall clock (`Date.now()`). `BOOKING_HORIZON_DAYS` (90, `apps/local-guest/src/concierge.ts:623`) is measured from the environment clock, so the latest accepted arrival is `2026-12-02`; a wall-clock arrival of `Date.now()+7d` first fell outside it on **26 Nov 2026**. From then on the turn was refused before `#executeDiscovery`, so the injected throwing `discoveryQuery` was never called.

- No commit changed the behaviour. `git log -S "500 responses carry a generic message"` finds only the commit that added the test (`0b6befd`, 28 Sep 2026); `git log -S "2026-09-03T10:00:00Z"` finds only `1a0f052`; `git log -S "at most 90 days ahead"` finds only `f347d9a` (26 Sep 2026). The test body is byte-identical at `985212b`.
- `985212b` is dated **2026-11-26 02:01 +0100**, the first day the wall clock pushed the date past the horizon.
- Proof the code path is intact: the same request with an in-window date (`10 Sep 2026`, seven days after the fixture clock) returns `500 {"ok":false,"code":"INTERNAL_ERROR","message":"Something went wrong. Please try again."}`.

## Decision: the code is right, the test input was wrong

- ADR 0075: internal error text never reaches the browser. It does not ask a failing deterministic search to be swallowed; it asks that whatever reaches the browser carries no detail.
- ADR 0080: the deterministic route is the fallback and must remain usable. A failing discovery query there is an internal error, and the endpoint's existing generic 500 (`apps/local-guest/src/guest-server.ts:5857`) is that path. No ADR makes a deterministic-mode failure degrade to `200`.
- ADR 0106: a thrown error becomes `CONCIERGE_UNAVAILABLE` only in an assistant runtime turn, which this fixture does not start (`conciergeMode: "deterministic"`).
- The test's intent — an injected search failure surfaces as the generic 500 with no detail — is unchanged. `SECRET-DETAIL` / `sk_live` assertions stay.

This is therefore a test bug, not a policy question; no owner decision is needed.

## Fix

- `test/helpers/pilot-fixture.ts`: `arrivalNextWeek(now: Date = new Date())` — callers that own a fixed clock pass it, everything else keeps the wall clock.
- `test/pilot-guardrails.test.ts`: the 500 test reads the arrival from `environment.clock()`, with a comment naming the horizon and the fixture clock. No assertion changed.

## Verification

- Before: `npx tsx --test --test-name-pattern "500 responses carry a generic message" test/pilot-guardrails.test.ts` → `0 pass, 1 fail` (`200 !== 500`).
- After: same command → `1 pass, 0 fail`.
- Whole file: `npx tsx --test test/pilot-guardrails.test.ts` → `7 pass, 0 fail`.
- `npm run check` → clean (root, `apps/cloudflare`, `tsconfig.test.json`, `tsconfig.tooling.json`, worker bundle guard).

(`NODE_ENV=test` was set and `LLM_API_KEY` removed for every run; this shell defaulted `NODE_ENV=production`, which makes `loadPaystackConfiguration` demand `PAYSTACK_SECRET_KEY` at server start.)
