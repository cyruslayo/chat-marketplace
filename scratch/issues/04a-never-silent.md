# Never silent: answer every message and keep the surface

Status: resolved
Type: task
Blocked by: 07, 02
Parent: [04](04-never-silent.md)

## What to build

Root cause: `#refreshWorkflow` runs before any text parsing (`guest-server.ts:224–228`) and returns `messages: []` for a pending request (:1283) and a confirmed booking (:1195). Always produce a reply for the stage the guest is in. Answer questions about the apartment from `unit.amenities` (`browse.ts:37`) via `guestAmenityLabel` (`apps/web-agent/src/guest-content.ts:12`), or say the fact isn't listed. For a submitted Booking Request, explain that it can't be changed and why. Draft changes are left to issue 14. Fix the fallback, which probably comes from re-processing the same surface id in `renderSurface` (`client.ts:474–481`). Wording comes from the 07 glossary.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC1: Every guest message gets an assistant reply in every workflow state.
- AC2: "is there parking" is answered from unit amenities, or with a statement that it isn't listed.
- AC4: "make it 3 nights" on a submitted Booking Request never changes it silently; the reply explains the amendment path or why none exists.
- AC5: A free-text turn with a live surface open does not demote that surface to the fallback.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0005 | Distinguish request, offer and reservation truthfully |
| 0060 | Changes after submission are versioned amendments |
| 0074 | Fail closed on stale surfaces, but keep safe text |
| 0075 | Guest text is untrusted |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- Root cause (AC1): `#refreshWorkflow` ran first and returned `messages: []` for a pending request and a confirmed booking, and the offer, payment and booking stages got a canned line. `#handleTurn` now builds a stage reply (`#stageReply`) after the refresh and adds it to any refresh result. When there is nothing else to say, `#capabilityReply` says where the details are and what the concierge can answer. The early `#rememberResult` of the refresh result is removed; `handleTurn` records the turn once.
- AC2: `amenityQuestions(text)` in `concierge.ts` detects facility questions (parking, pool, Wi-Fi, power, security, air conditioning, workspace, gym, kitchen, balcony). The answer comes only from `unit.amenities` via `guestAmenityLabel`: "Yes: {apartment} lists Secure parking." or "Parking isn't listed for {apartment}, so I can't confirm it." This works from the unit detail onward, including after submission, where the Unit is read from the Booking Request. Guest text is never echoed (ADR-0075).
- AC4: `stayChangeRequested` flags date, night, guest and area changes and phrases like "make it". After submission, `#changeExplanation` replies per stage and nothing is changed:
  - Request: it can't be changed while the Operator reviews it, and the no-cost exit is not accepting the offer (PRD decision 2).
  - Offer: the same no-cost exit.
  - Payment: an accepted offer can't be changed here.
  - Confirmed booking: changes go through a booking amendment that re-checks availability and price (ADR-0060), which this conversation can't start yet.
  Draft-stage changes remain with issue 14.
- AC5: Root cause was that `renderSurface` re-processed `createSurface` for a surface id this page already held, Weaver returned `SURFACE_ALREADY_EXISTS`, and the workspace fell back. The client now tracks created ids and sends `deleteSurface` before re-creating (ADR-0074). The browser test fails without this fix and passes with it.
- Side effect fixed: reopening the workspace used to fall back for the same reason, which had hidden a focus race. With reopen rendering properly, focus moved to the sr-only heading instead of the close control. The focus target is now chosen by priority rather than document order, and S1 "AC29 — Focused workspace closes and reopens from the keyboard" passes 4/4 again.
- Tests: `test/guest-never-silent.test.ts` covers AC1 (a free-text turn at all 11 stages), AC2 (Ikoyi has parking, Lekki does not) and AC4 (request unchanged, one request only, amendment reply after confirmation). The AC5 browser test is in `mobile-guest-journey-chromium.test.ts`. `restartFixture().advance()` now awaits its per-stage callback.
- Verification: `npm run check` passed. `npm test`: 1,104 passed, 2 failed, 1 skipped. Both failures were load timeouts before the relevant step (RB2 cross-tab and S1 AC4 Escape), and each passed 3/3 when rerun alone. Walkthrough at 375px and 1280px on :3004 covered unit questions (parking yes, gym not listed), the change request on a sent request, "ok thanks", a reload restoring the rich surface, a free-text turn, and close/reopen keeping Weaver rendering with focus on the close control. No overflow and no application console errors; one 401 came from the tab's first load at localhost with a stale cookie before switching to 127.0.0.1.
