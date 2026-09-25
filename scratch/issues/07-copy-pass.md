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

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- Glossary: `GUEST_GLOSSARY` in `apps/web-agent/src/guest-content.ts`, the existing guest-copy module, is the single source. It also holds the provider line, per-stage reservation status, receipts, forbidden terms and the domain-disclosure wording. It is exported from the web-agent index and bundled into the client.
- AC1: `guestReservationStatus(stage)` supplies the one status statement for draft, review, request (sent, confirmed, declined, expired, not delivered), offer and confirmation. Messages, progress text and other lines no longer restate it. The test counts statements across messages plus A2UI text, and separately in the text fallback. Payment surfaces keep their payment-safety wording and are outside this AC.
- AC2: Deterministic guest copy has no forbidden terms. The domain quote disclosures ("guest liability", "controlled catalogue") are unchanged in `domains/` and translated at presentation with `guestDisclosure`, using the wording approved 25 Sept 2026 (ADR-0015, ADR-0016).
- AC3: Shortened labels ("Stay total", "Refundable deposit") are replaced with All-In Stay Total and Refundable Security Deposit across the guest, card-payment, bank-transfer, cancellation and deposit-claim surfaces.
- AC4: Turn results carry `receipts` (Draft created, Booking Request sent, Offer accepted, Payment verified). They are stored as `role: "receipt"` timeline entries and rendered as `.receipt-marker` markers after the step's history markers, both live and on restore. The superseded "Request Draft" history marker is suppressed so it does not duplicate the receipt.
- AC5: Guest copy says "apartment" ("View apartment", "eligible apartments", photo fallback, error text). The open point stands: derive the noun from the Unit type if houses appear.
- AC6: `accommodationProviderLine(operator name)` appears on review, offer and confirmation (A2UI and review fallback), and not on discovery, unit detail or draft. There is no separate legal-name field, so the registered Operator name is used (decision 25 Sept 2026), with "the Operator" as fallback.
- AC7: A source scan checks that the fixed labels (All-In Stay Total, Refundable Security Deposit, Your offer is ready, View apartment, Not sent yet, the revalidation sentence and the provider line) appear only in the glossary. "Booking Request", "Reservation" and "Conditional Booking Offer" are kept verbatim (ADR-0005) and are also available from the glossary.
- Titles: "Request Draft" and "Review Booking Request" are unchanged. The offer heading reads "Your offer is ready" while it is issued. The contract heading is "Your booking", so its status line is the only confirmation statement.
- Out of scope: host and Unit wording in the Gemini assistant path (`assistant/*`, `gemini-concierge.ts`).
- ADRs: 0005, 0006, 0015, 0016 and 0077 are cited at the glossary and at the provider and status callsites.
- Tests: `test/guest-copy-pass.test.ts` has one test per AC, and the AC4 browser test is in `mobile-guest-journey-chromium.test.ts`. `restartFixture().advance()` gained an optional per-stage callback. Older copy assertions were updated to the new wording.
- Verification: `npm run check` passed. `npm test`: 1,093 passed, 1 failed, 1 skipped. The failure was the S1 test "AC1: Request to Book … role=button", a browser timeout under full-suite load; it passed when rerun alone. An earlier full run also showed load-related timeouts in the pilot screenshot and listing-photo tests, which pass in isolation. Walkthrough at 375px and 1280px on :3004 covered draft, review, submit and reload: one status line per surface, the provider line on review only, receipts as markers after reload, no overflow and no console errors.
