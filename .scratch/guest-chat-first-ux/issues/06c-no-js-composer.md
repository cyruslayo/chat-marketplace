# Composer works without JavaScript

Status: resolved
Type: task
Blocked by: 06b
Parent: [06](06-conventional-routes.md)

## What to build

Give the composer form (`guest-server.ts:1628`) a real `action` and `method`. Add a POST route that runs the turn and returns a server-rendered transcript with the conventional links from 06a and 06b.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC3: With JavaScript disabled, posting the composer produces a server-rendered reply.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0080 as modified by 0081 | Material workflows have conventional route parity |
| 0070–0072 | Routes re-authorize and version-check commands |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/06c-no-js-composer.md` (repo root). The composer posts to `POST /conversation` with a hidden `threadId`. It returns a 303 redirect to `GET /conversation`; invalid input gets a 400 or 422 transcript and keeps the draft. `Referrer-Policy: same-origin` lets same-origin posts pass the Origin check.
  - Evidence: test/guest-no-js-composer.test.ts (AC3 over HTTP, failure paths); test/guest-no-js-composer-chromium.test.ts (scripts disabled). Code: apps/local-guest/src/guest-server.ts (`POST /conversation`, `GUEST_HTML_HEADERS`, `renderNoScriptConversationHtml`). Landing: PR #58, commit 608c9d0.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
