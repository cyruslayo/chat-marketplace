# Shortlet façade, payments group: fold Application pass-throughs, remove readonly manager

Status: ready-for-agent
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

## Comments
