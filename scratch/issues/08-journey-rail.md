# Journey rail and back to results

Status: resolved
Type: task
Blocked by: 04a
Findings: F5 (see ../PRD.md)

## What to build

Add a compact rail (Search → Stay → Request → Offer → Pay → Confirmed) derived from the workflow projection, including failure and expiry states. From stay detail, allow going back to the results for the same search, which removes the linear-demo limitation at `guest-server.ts:898`.

## Acceptance criteria

- AC1: The rail's current stage matches the server projection after every event and after reload.
- AC2: Expired and declined states show on the rail as themselves, not as progress.
- AC3: "Back to results" from stay detail restores the previous results with the same criteria.
- AC4: Going back never cancels a submitted Booking Request.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0005 | Stages mirror request-to-book projections |
| 0079 | Recovery restores the stage without restarting work |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- **Projection.** `apps/local-guest/src/journey-rail.ts`:
  - `projectJourney` builds six steps (Search → Stay → Request → Offer → Pay → Confirmed).
  - Steps before the current one are `done`. An outcome makes its own step `failed`: it is never `done` or `current`, and every later step stays `upcoming` (AC2).
  - Step names are `GUEST_JOURNEY` in `guest-content.ts`. Outcome labels reuse existing headlines: `guestRequestStatus` ("Request declined", "Request expired", "Request could not be delivered"), "Offer expired" and "Offer no longer current" from the offer fallback, and "Payment window expired" from `guestPaymentStatus`.
- **Server.** `LocalGuestApp.#journeyFor` reads the authoritative request, offer and payment artifacts and the booking snapshot on every call. A deadline that has passed shows as expired without a background job (AGENTS anti-pattern 2), and reading never issues a command (ADR-0079).
  - "Confirmed" requires the durable Booking Contract snapshot (ADR-0005).
  - `journey` is on every successful turn and event result and on `GET /api/state`, through `#withJourney`. The assistant-runtime path is unchanged.
- **Back to results.**
  - `BACK_TO_RESULTS_EVENT` (`shortlet.unit-detail.back-to-results`) is a secondary button on unit detail, both live and restored. It is allow-listed under the unit stage, so only the active unit surface can send it.
  - `#handleBackToResults` fails closed:
    - a sent request or offer → `STALE_SURFACE`, and nothing is touched (AC4);
    - no search → `INVALID_ARTIFACT`;
    - a context other than exactly `{ artifactId }` of the current discovery artifact → `INVALID_CONTEXT`.
  - It re-presents the stored artifact as a new discovery revision (ADR-0074), with the same filters, results and conventional route, and runs no new search. The superseded unit surface's actions become stale.
  - `discoverySurface()` is now shared by restore and back.
- **Client.**
  - `#journey-rail` (`<nav aria-label="Booking progress"><ol>`) sits under the header. `aria-current="step"` marks the current step, and each step also has visually hidden state text ("completed", "not started" and so on).
  - A failed step takes its tone from `guestStatusTone`.
  - `readGuestResponse` rejects a malformed `journey`.
  - The list scrolls inside itself. `position: relative` keeps the absolutely positioned hidden text inside the scroller: without it, that text caused 3px of document overflow at 320px, which `discovery-phase3-chromium` caught.
  - Below 30rem the spacing tightens so all six steps fit at 375px.
- **No-JS.** `renderNoScriptConversationHtml` renders the same rail (ADR-0080).
- **Tests.**
  - `test/guest-journey-rail.test.ts`: AC1–AC4 over HTTP, plus `projectJourney` and the no-JS rail.
  - `test/guest-journey-rail-chromium.test.ts`: AC1 in real Chromium at 375px (search → stay → back → stay → reload), plus hidden state text and no document overflow at 320px.
  - `guestAction(surface, name?)` can pick a button by event name.
- **Wording added.** "Back to results", "Here are your search results again." and "Those search results are no longer available." None of it is money or legal copy.
- Verification:
  - `npm run check` passed.
  - The first full run of `npm test` had 1,119 passed, 1 failed and 1 skipped. The one failure was the 320px overflow, which is now fixed.
  - The clean full run had 1,118 passed, 2 failed and 1 skipped. Both failures pass on their own and passed in the first run, so they are load flakes:
    - `guest-real-browser-cross-tab` RB1 (a 70 s wait timed out);
    - `pilot-local` AC4 (`spawnSync ETIMEDOUT`).
  - Walkthrough on :3005, because another session held :3001. At 375px: search → stay → back to results → stay → request, then a decline and a reload. At 1280px the rail has no overflow.
