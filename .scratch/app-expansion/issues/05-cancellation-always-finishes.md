# A half-done cancellation is always finished

Status: ready-for-agent
Type: task
Blocked by: 03, 04 (D4 accepted 25 Nov 2026)

## Defect (latent)

`CancellationApplication` moves the Reservation to `cancelled` first, then posts the ledger, releases dates and starts refunds. A failure leaves the case part-done. The class has no resume, the case store is in memory, a failed ledger stops everything after it, and the guest has no action (rules 01 P1, P4, trial B).

## What to build (D4)

- A durable cancellation case store (SQLite, with its migration and export entry), replacing the in-memory default in every composition.
- A resume operation for staff or the system: idempotent, running only the unfinished steps. A failed step never prevents an independent one, so a failed ledger post must not stop the date release or the recorded refund.
- The refund becomes a recorded obligation with the exact amount and source, paid by staff and closed with the provider's refund reference, following `recordGuestRefund` and the existing Operator home item. No provider refund call (pilot policy).
- A read model the guest screen can show: cancelled; dates; each refund's state.

## Acceptance criteria

- AC1: For every combination of one failure in ledger, dates, stay refund and deposit refund, resuming reaches: ledger posted, dates released, and each refund settled or an open staff item.
- AC2: Resuming a finished case changes nothing and calls no port.
- AC3: Two resumes at once release the dates once and record each refund once.
- AC4: The sum of refunds never exceeds the sum paid, and the deposit is never added to the stay refund.
- AC5: The case survives a restart and is in the daily export.
- AC6: A guest of another Reservation, a missing tenant, and a guest calling resume are refused.
- AC7: With the resume removed, AC1 fails (recorded in Comments).

## ADR compliance

0016, 0045, 0058, 0072, 0075, 0089, 0095, 0096; `docs/policy/shortlet-pilot-payments.md`.

## Comments
