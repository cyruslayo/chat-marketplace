# Liveness: typing indicator, timeout, retry

Status: resolved
Type: task
Blocked by: 05
Findings: F12 (see ../PRD.md)

## What to build

Show a typing indicator while a turn is pending. Add a fetch timeout, and on failure show a Retry control that re-sends the same idempotent turn and keeps the draft text.

## Acceptance criteria

- AC1: A pending turn shows an indicator that is announced once.
- AC2: A turn that times out shows Retry and keeps the text.
- AC3: Retrying a command event does not create a second Booking Request.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0079 | Retry never repeats a committed command |
| 0070–0072 | Duplicate events are deduplicated server-side |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/12-liveness.md` (repo root). `#working-status` is shown and announced once while a turn is pending. `postJson` aborts after 10 seconds and treats non-2xx as failure. The failure turn offers Retry, which re-sends the same turn and keeps the text. A retried command returns the original result (ADR-0070–0072).
  - Evidence: test/mobile-guest-journey-chromium.test.ts AC1 (indicator announced once) and AC2 (timeout shows Retry, text kept); test/guest-booking-journey.test.ts:57 ("AC3: Retrying a command event does not create a second Booking Request"). Code: apps/local-guest/src/client.ts (`postJson`, `working-status`, Retry). Landing: PR #51, commit 6230c96.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
