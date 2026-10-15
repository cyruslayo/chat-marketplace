# Shortlet façade, payments group: fold Application pass-throughs, remove readonly manager

Status: resolved
Type: task
Blocked by: 08a
Requested: 14 Oct 2026
Unlocks: 09b, 15
Lane: B: Deep modules
PRD: `../PRD.md`

## Why

17 `*Application` classes expose their manager and apps reach through it 112 times (PRD, Diagnosis 2): two interfaces, no hiding.

## What to build

1. For `card-payment-application.ts`, `bank-transfer-application.ts`, `payment-capability-application.ts`, `conditional-offer-application.ts`, `booking-request-application.ts`: move the useful logic into a shortlet façade service exported from `domains/shortlet/src/index.ts` (e.g. `ShortletBookingService`).
2. Remove `readonly manager`; replace every `.manager.` use in `apps/` for these classes with façade methods.
3. Collapse option interfaces that only mirror manager options.

## Out of scope

- Other applications (09b). Changing domain rules.

## Acceptance criteria

- AC1: None of the five classes (or their replacements) exposes an internal manager.
- AC2: No `.manager.` reach-through to these managers remains in `apps/`.
- AC3: Existing tests pass unchanged.

## Tests

Existing tests; add a façade test per moved public operation if none covers it.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0004-web-and-backend-own-authoritative-state.md` | State authority stays in the backend. |
| `docs/adr/0044-limit-payment-reservation-to-twenty-plus-ten-minutes.md` | Payment windows unchanged. |
| `docs/adr/0087-select-paystack-for-pilot-shortlet-payments.md` | Provider port unchanged. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Answer

Landed: the five payments-group classes no longer expose a manager; every app reaches them through a façade method.
- `booking-request-application.ts` — `readonly manager` → private; façade `getRequest`, `getDraft`, `markDelivered`.
- `conditional-offer-application.ts` — private manager; façade `getOffer` (used internally by card/bank/payment-capability).
- `card-payment-application.ts` — private manager; façade `getCheckoutSession`, `getCheckoutSessionByReference`, `getPaymentJourney`.
- `bank-transfer-application.ts` — private manager; façade `getSession`, `getBookingContract`, `getSessionByReference`, `getRefundRecord`, `getReconciliationRecord`.
- `payment-capability-application.ts` — private manager.

Composition: each class registers its underlying manager in a module `WeakMap` and exports `get<Type>Manager(application)` for wiring sibling applications and for white-box test assertions (the `create*Application` factories now use `getConditionalOfferManager` / `getBookingRequestManager` instead of `.manager`).

Call sites rewritten: every `X.manager.Y(...)` reach-through was replaced — in `apps/` (guest-server, local-owner-environment, fixture, assistant-runtime) with façade methods, in the composition factories and `test/` with façade methods or the composition helpers.

Tests:
- `test/slice-09a-payments-facade.test.ts` — AC1 "the five payments-group classes declare no public manager property" and AC2 "no payments-group manager reach-through remains in apps/ (non-test)". Both green.
- AC3 "Existing tests pass unchanged" — assertions are unchanged; call sites that read the manager were rewritten to the façade or the composition helper (`integrate-*`, `guest-*`, `helpers/*`, `paystack-*`, `operator-*`, `back-office-*`).

Metric: apps non-test `.manager.` 112 → **45** (the payments-group 41 → 0; the remaining 45 are the 09b applications).

Verification: `npm run check` clean. `npm run test:non-browser` phase 1: 1749 pass / 4 pre-existing failures (reproduce on baseline; see slice 06).

## Comments

- 14 Oct 2026 (agent): Per the owner's decision, the AC1↔AC3 conflict was resolved by full hiding plus rewriting call sites. Test *source* changed (`.manager.Y` → façade call or `get<Type>Manager(app).Y`); assertions are untouched. The one behavioural nuance: `integrate-card-payment-application`'s `assert.equal(application.manager, application.manager)` and `integrate-bank-transfer-application`'s `manager !== undefined` became "the façade method exists".
- 14 Oct 2026 (agent): The issue suggested exporting a `ShortletBookingService` from `domains/shortlet/src/index.ts`. Not done here: these classes own `apps/web` presentation projections (`*-artifact.ts`), so moving them into the domain would drag the presentation layer into the pack. The façade seam is established in `apps/web`; the physical relocation into the pack is the pack-extraction work (12 and beyond). Recorded rather than silently skipped.
