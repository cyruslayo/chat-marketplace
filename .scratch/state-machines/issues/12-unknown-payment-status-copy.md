# 12 An unknown payment status no longer says "Booking confirmed"

Status: ready-for-agent
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
