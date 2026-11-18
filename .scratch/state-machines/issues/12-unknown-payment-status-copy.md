# 12 An unknown payment status no longer says "Booking confirmed"

Status: resolved
Type: task
Track: C (one named behaviour change)
Blocked by: 09

## Defect

`guestPaymentStatus` in `apps/web-agent/src/booking-presentation.ts` handles every `CardPaymentStatus` member through `GUEST_PAYMENT_STATUS_COPY`. That part is exhaustive since issue 09. The problem is a runtime value outside the union, for example from a corrupt or newer stored artifact. Such a value still falls back to the **confirmed** copy ("Booking confirmed · Payment verified and Reservation confirmed."), which tells a guest a booking exists when nothing confirms it. `cardPaymentCopy` in `payment-presentation.ts` then shows "Booking confirmed" as its status pill.

## Fix

Change one behaviour: an out-of-union status gets the "status unavailable" copy, not the confirmed copy.

- **Copy.** Mirror the existing fallback in `guestRequestStatus` (same file), whose label is `` `${GUEST_GLOSSARY.bookingRequest} status unavailable` `` and whose detail is "Refresh the current booking status before taking another action.".
  - Payment label: "Payment status unavailable".
  - Payment detail: the same refresh sentence.
  - No `progress`.
  - Do not invent other copy.
  - If `apps/web-agent/src/guest-content.ts` keeps label strings like these in a shared object, add the label there in the same style.
- **`cardPaymentCopy`** for an out-of-union status: keep the title "Payment status" as today; the status pill becomes the new label.

## Acceptance criteria

1. An out-of-union status gets the label "Payment status unavailable", the refresh detail, and no progress. It never gets "Booking confirmed".
2. `cardPaymentCopy` for an out-of-union status has title "Payment status" and status pill "Payment status unavailable".
3. Every in-union status, with `processing` true and false, still renders exactly as before. The issue 09 characterisation tests pass unchanged, except the two runtime-fallback assertions, which this issue deliberately updates.

## Tests

- Update the two out-of-union assertions in `test/presentation-copy-exhaustive.test.ts`, and add one `test()` per acceptance criterion.
- Re-run:
  - every test whose name contains `payment-presentation`, `booking-presentation`, `guest-payment` or `guest-offer`;
  - `test/presentation-copy-exhaustive.test.ts`;
  - `test/state-machine-inventory.test.ts`.
- Run `npm run check`.
- No real-Chrome run: the state cannot be reached through the UI.

ADRs: 0074 (fail closed). See also UX guidelines §9-10 (`docs/design/shortlet-ux-guidelines.md`).

## Comments

- Failing tests first: `test/presentation-copy-exhaustive.test.ts` now has AC1 (out-of-union label, detail, no progress, never "Booking confirmed"), AC2 (cardPaymentCopy title and pill) and AC3 (in-union unchanged). The two old runtime-fallback assertions were replaced by AC1 and AC2.
- Before the fix: `env -u LLM_API_KEY npx tsx --test` over the 8 files below gave `# tests 56`, `# pass 54`, `# fail 2`. The two failures were `AC1: an out-of-union status ...` and `AC2: cardPaymentCopy for an out-of-union status ...`.
- Fix: `apps/web-agent/src/booking-presentation.ts` adds `GUEST_PAYMENT_STATUS_UNAVAILABLE` (label "Payment status unavailable", the refresh sentence from `guestRequestStatus`, no progress) and `guestPaymentStatus` returns it for any value outside the map. `payment-presentation.ts` needed no change: its status pill already falls back to `detail.label`, and its title fallback stays "Payment status". `guest-content.ts` was not touched because it has no shared label for these strings, and `guestRequestStatus` keeps its copy inline.
- Doc: `docs/agents/state-machines.md` row "Payment and offer copy" now states the new fallback.
- After the fix, same command: `# tests 56`, `# pass 56`, `# fail 0`. Files: `test/guest-offer-access.test.ts`, `test/guest-offer-consistency.test.ts`, `test/guest-offer-payment-clarity.test.ts`, `test/guest-payment-choice.test.ts`, `test/guest-payment-consistency.test.ts`, `test/phase4-booking-payment-presentation.test.ts`, `test/presentation-copy-exhaustive.test.ts`, `test/state-machine-inventory.test.ts`. The chromium files were excluded.
- `env -u LLM_API_KEY npm run check` exit 0, zero `error TS` lines.
- Definition of Done: each AC has a named test (1 to 1). Failure path covered: the out-of-union status, with processing true and false. No `any` added. The copy is taken from the issue and `guestRequestStatus`. No new constructor parameters. ADR 0074 (fail closed) is the only ADR, and it is applied. No credentials are touched. Real-Chrome: not run, as the issue says.
- Not run: the full `npm test` (batch gate, DoD item 7 is confirmed there), and `npm run test:workers` (not affected: no Worker code changed).
- Unconfirmed: with a processing stage (`stay_payment_processing`), an out-of-union status still shows the title "Payment being checked" and pill "Payment processing", because the processing override runs before the fallback. AC2 only covers the non-processing case, so I did not change it.
- Orchestrator review: diff read; re-ran the 8 files (56 pass) and `npm run check` (exit 0). The processing-stage case (title "Payment being checked") makes no booking claim, so it stays out of scope.
