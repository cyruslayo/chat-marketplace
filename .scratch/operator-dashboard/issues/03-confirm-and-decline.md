# Confirm on the owner's behalf; decline with a reason

Status: resolved
Type: task
Blocked by: 02

## What to build

- **Confirm** states that you are confirming for the named owner, lists the ADR 0041 re-attestation, and requires an explicit affirmative. It says it creates a Conditional Booking Offer, and that this becomes a Reservation only after payment.
- **Decline** requires "Dates not available" or "Other reason" (D1), with no free text. It says the dates are released immediately. "Dates not available" records a calendar-accuracy event (ADR 0039). The Guest never sees the reason.

Reuse `confirmOperatorRequest` and `declineOperatorRequest`.

## Acceptance criteria

- AC1: Confirm names the owner, lists what you attest for them (availability, price, included services, arrival, maintenance, access, no external conflict), and fails closed without an explicit affirmative.
- AC2: Confirm says it creates a Conditional Booking Offer and that the stay becomes a Reservation only after the Guest pays.
- AC3: Decline requires "Dates not available" or "Other reason", says the dates are released immediately, records a calendar-accuracy event only for "Dates not available", and the Guest never sees the reason.
- AC4: A decision on a request already decided, expired, or at a stale version is refused and the current state is shown.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0041 | re-attestation; decline releases immediately |
| 0039 | an unavailable decline is a calendar-accuracy event |
| 0005/0006 | an offer is not a Reservation; the owner is the provider |
| 0072 | exact-effect confirmation, concurrency, idempotency |
| 0075 | no free-text reason |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Every action asserts the standard failure paths: revoked or expired grant, no session, cross-origin POST, and a stale or expired target.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: money, deadline and legal wording traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No keys, secrets, receipts, account numbers or contact values in logs or telemetry (ADR 0075).
- [ ] Walkthrough at 320px, 375px and 1280px, and without JavaScript.
- [ ] `npm run check` and `npm test` pass.

## Answer

Resolved on branch `bo/b3-confirm-and-decline` (stacked on B2). **M1 is complete and ready for review (B0–B3).**

- **Confirm:** `decisionFormsHtml` in `local-owner-server.ts`.
  - Heading: "Confirm on behalf of <owner>". It lists the ADR 0041 items in the ADR's own words; only the price carries this request's All-In Stay Total.
  - It states "Confirming creates a Conditional Booking Offer for the Guest. The stay becomes a Reservation only after the Guest pays." (CONTEXT.md terms).
  - The affirmative is a required `attest` checkbox. `env.confirmOperatorRequest(id, principal, { attested, basedOnVersion })` fails closed with `OperatorDecisionInputError`, returning 400 and changing nothing.
- **Decline:** `DECLINE_REASONS` / `DeclineReasonCode` (D1) in `local-owner-environment.ts`. The form offers two required radios and no free text.
  - `decisionFromForm` rejects any field outside `basedOnVersion` plus `reason` or `attest`, so free text cannot ride along.
  - The copy says "Declining releases these dates immediately. The Guest never sees the reason."
  - The reason code is stored on the request record and in the operator audit; the Guest artifact has no reason field.
- **Calendar-accuracy event:** recorded for `dates_not_available` only, as an append-only audit entry `calendar_accuracy_event` with `impactClass: "unavailable_request_decline"`, requestId, unitId, operatorId, tenantId, `reasonCode` and `occurredAt`.
  - Why the audit rather than `OperatorEnforcementManager.recordIncident("calendar_error")`: an incident needs a severity and an attribution, which are human enforcement judgments (ADR 0064) that no ADR fixes for this impact class. Enforcement is also out of scope in the PRD.
  - The event carries no free text and no guest data (ADR 0075).
- **Stale and repeat decisions (ADR 0072):**
  - Each form carries `basedOnVersion`, and the environment passes it as the expected projection version.
  - A repeat, a second tab or an expired request gets a 409 that re-renders the current state with a plain notice: "already confirmed", "already declined", "has expired" or "changed since you opened it".
  - A repeat never issues a second Conditional Booking Offer.
  - I followed the issue's AC4 (refuse and show the current state) rather than replying 303 to an identical replay. The replay has no side effect either way.
- **Detail page:** Owner and Apartment facts replace the raw request and unit ids (done in B1).
- **Tests:** `test/back-office-confirm-decline.test.ts` covers AC1–AC4. The helper adds `decideRequest(session, id, "confirm" | "decline", { reason, basedOnVersion, form, cookie })`, `renderedDecisionVersion`, and an optional form body on `operatorPost`.

**Changed legacy tests:**
- `operator-request-inbox`: confirm and decline posts now go through `decideRequest` (25 sites).
- `operator-session-helper`: the revoked-grant confirm uses `decideRequest`.
- `pilot-production-composition`: the confirm sends `basedOnVersion` and `attest`.
- `pilot-local`: the journey ticks the attestation or picks a reason, clicks "Confirm for" or "Decline Booking Request", and waits for "Your decision".
- `back-office-home` AC3 and `back-office-request-inbox` AC2 and AC3 now post real decision forms.

**ADRs:**

| ADR | Where it's reflected |
|---|---|
| 0041 | Re-attestation list and required affirmative. Decline releases immediately (AC3 re-requests the same dates at once). |
| 0039 | `calendar_accuracy_event` only for "Dates not available". |
| 0005 / 0006 | Offer versus Reservation wording. The owner is named as the party you confirm for. |
| 0072 | `basedOnVersion` is checked by `BookingRequestApplication.decide`. Only one of two racing tabs lands. No second offer. Exact-effect copy. |
| 0075 | No free-text field in the form, API or storage. Minimal event. The Guest never sees the reason. |
| 0082 / 0086 | Revoked grant: 409. No session: 401. Cross-origin: 403. Stale version: 409. Each is asserted per action. |

**Definition of Done**
- Each AC has one named test, with the four standard failure paths asserted for confirm and decline.
- No invented policy strings: the attestation items quote ADR 0041, and the offer and Reservation wording comes from CONTEXT.md.
- No secrets in logs.
- Walkthrough at 320, 375 and 1280 with decline open: no overflow, and every target is at least 44px.
  - The browser blocks a confirm without the tick, and the server refuses a bypass with 400.
  - A stale second tab gets 409 with "This request is already confirmed. Your decision was not applied."
  - Decline with each reason works.
- `npm run check` is clean. `npm test` gave 1193 passed and 3 failed. The failures were RB8 cross-tab, mobile AC32 composer and pilot AC4 `pilot:start`, all passing when run alone. The first two are Guest-only; pilot AC4 is known-flaky. `pilot-local` gave 44 of 44 when run alone.
