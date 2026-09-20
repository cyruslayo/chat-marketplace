# Capture pilot Guest contact

Status: claimed

## What to build

Capture a Nigerian Guest phone number before Booking Request submission and a contact email before payment continuation. Persist both in SQLite without treating either as verified identity. Snapshot phone on the Booking Request and email on the Live Payment Attempt, expose phone only on authorized Operator request detail, and keep contact data out of lists, telemetry, and logs.

## Acceptance criteria

AC1–AC29 are the criteria supplied in the implementation request and are mirrored one-for-one in `test/guest-contact-pilot.test.ts`.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
|---|---|---|
| 0004 | Backend owns authoritative state | SQLite contact source; AC9–10, AC15–18 |
| 0011 as narrowed by 0085 and this pilot policy | Contact is separate from identity; no KYC gate | AC1–4, AC28 |
| 0044, 0046, 0049 | Preserve payment window, one live attempt, hosted checkout authority | Email gate and immutable checkout snapshot; AC12, AC17–18, AC29 |
| 0070–0075 | Bind session/domain identities, use commands, fail closed, minimize personal data | Contact application, revision checks, privacy tests; AC17–21, AC25 |
| 0077, 0080, 0081 | Canonical presentation and deterministic parity; Weaver stays presentation-only | Shared contact application and conventional form; AC25–27 |
| 0082, 0086 | Operator detail requires authenticated representative grant | Detail-only phone projection; AC22–24 |
| 0087 | Future Paystack initialization uses authoritative Guest email and server-owned amount/currency | Checkout email snapshot; AC12–18, AC29 |

## Definition of Done

- [x] Every AC has one named test and named failure paths are asserted.
- [x] Relevant ADRs were read and mapped above.
- [x] No unused dependencies or invented service boundaries were added.
- [x] No bearer credentials or raw contact values enter audit or telemetry.
- [x] Type checking and focused tests pass.
- [ ] Full repository test result is recorded below before commit.

## Comments

ADR-0011's older verified-contact preparation rule is narrowed for this pilot: phone is unverified Booking Request contact, email is unverified payment contact, and ADR-0085 keeps identity verification outside Booking Eligibility. Raw phone disclosure is specifically approved only for an authorized Operator representative's request-detail view.

Validation: `npm run check` passed; focused Guest contact, Operator inbox, restart, payment, and mobile form tests passed; `git diff --check` passed. The full `npm test` run reached 832 passing tests and four failures in the legacy Operator demo/browser cleanup path before the fixture-only phone source correction; the isolated failing Operator suite passed after correction, and the previously flaky RB5 real-browser case passed on rerun. Bundle remained 348,446 bytes (0 byte change). Commit: `72103312bb010c47fc828e66a6c7c8a501038a48`.
