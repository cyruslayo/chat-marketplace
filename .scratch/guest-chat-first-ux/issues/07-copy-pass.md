# Copy pass: one status line, plain vocabulary

Status: resolved
Type: task
Findings: F6 (see ../PRD.md)

## What to build

Show one status line per workflow state instead of repeated "not reserved" disclaimers. Render receipts such as "Draft created" as quiet timeline markers.

Add one guest-vocabulary glossary module that every guest surface reads its labels from, so wording is not changed surface by surface (ADR 0077). Domain code, types and CONTEXT.md terms stay unchanged; this affects presentation only.

## Decision (approved 25 Sept 2026)

| Domain term | Guest-facing wording | Basis |
|---|---|---|
| All-In Stay Total | Keep exactly | ADR 0015 |
| Refundable Security Deposit | Keep exactly | ADR 0016 |
| Booking Request / Reservation | Keep both; state which one applies once per surface | ADR 0005 |
| Conditional Booking Offer | Keep the term; heading may read "Your offer is ready" | CONTEXT avoids "booking confirmation" |
| Accommodation Provider | Show only on review, offer and confirmation surfaces, as "Provided by {Operator legal name} (your accommodation provider)" | ADR 0006 disclosure of the contracting party |
| Operator | Use the Operator's name where known ("{name} will confirm…"); otherwise "Operator". Never "host" | CONTEXT avoids "host" |
| Unit | **"apartment"** in guest copy ("View apartment", "this apartment") | CONTEXT defines Unit as a self-contained apartment or house |
| Request Draft | Status "Not sent yet" | Internal state; blocks nothing |
| "revalidated" | "We re-check price and availability when you send" | ADR 0015 revalidation, plainly stated |
| "guest liability", "controlled catalogue" | Remove from guest copy | Internal ledger and catalogue terms (ADR 0016) |
| "escrow", "guarantee", "verified badge", "host" | Never use | CONTEXT avoided terms; ADR 0016 |

Open point: "apartment" does not fit a Unit that is a house. If house inventory appears, derive the noun from the Unit type rather than hardcoding it.

## Acceptance criteria

- AC1: Each surface states reservation status exactly once.
- AC2: No guest-facing surface contains "revalidated", "controlled catalogue", "guest liability", "escrow" or "host".
- AC3: All-In Stay Total and Refundable Security Deposit labels are unchanged.
- AC4: Receipts render as markers, not assistant turns.
- AC5: Guest-facing surfaces say "apartment" and never "Unit".
- AC6: The Accommodation Provider line with the Operator's legal name appears on the review, offer and confirmation surfaces, and on no discovery or draft surface.
- AC7: Every guest label in the table comes from the single glossary module.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0005 | Booking Request and Reservation stay distinct |
| 0015 | All-In Stay Total wording |
| 0016 | Refundable Security Deposit wording |
| 0006 | The contracting Operator is disclosed as Accommodation Provider where the contract forms |
| 0077 | Canonical meaning across channels; one glossary source |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/07-copy-pass.md` (repo root). `GUEST_GLOSSARY` in `guest-content.ts` is the single copy source. Each surface has one reservation status statement. Receipts render as `.receipt-marker` markers. The provider line appears on review, offer and confirmation, and the AC7 source scan keeps the fixed labels in the glossary.
  - Evidence: test/guest-copy-pass.test.ts (one test per AC); AC4 in test/mobile-guest-journey-chromium.test.ts. Code: apps/web-agent/src/guest-content.ts (`GUEST_GLOSSARY`, `guestReservationStatus`, `accommodationProviderLine`). Landing: PR #52, commit dea991a.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
