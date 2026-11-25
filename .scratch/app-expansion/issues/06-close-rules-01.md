# Close rules page 01

Status: resolved
Type: grilling
Blocked by: none (D3 and D4 accepted 25 Nov 2026; the cells need the owner)

## What to settle

`rules/01-after-booking-money.md` has 26 cross-check cells marked `?` and 8 scenarios. An agent prepares, for each cell, the ADR text that answers it or one scenario with a recommendation. The owner answers.

## Acceptance criteria

- AC1: No cell says `?`. Each has a source or an owner answer with its date.
- AC2: Every Proposed rule is accepted, changed or rejected in `decisions.md`.
- AC3: Deposit claims, relocation and no-show have their own cells, or a dated note saying which issue adds them.
- AC4: An answer that changes an ADR is written as an ADR amendment for the owner, not only here.

## Comments

### 25 Nov 2026 — Owner answers recorded (`accept all`, D23–D32)

- **AC1:** Zero `?` cells remain in `rules/01-after-booking-money.md`; every cell cites an ADR or owner decision (`D3`, `D23`–`D32`, 25 Nov 2026).
- **AC2:** All Proposed rules (`S1`, `S4`, `P2`, `P3`) and Scenarios 5–8 are accepted/settled in `decisions.md` (`D23`–`D32`).
- **AC3:** `No-Show confirmed` row added under `S1`/`S2` (ADR 0058, D32). Dated note (25 Nov 2026, D32) defers deposit claims (ADR 0016–0020; zero deposit in pilot, ADR 0089, ADR 0092) until deposit collection is enabled, and defers relocation (ADR 0028–0029; refund-only in pilot, ADR 0089, ADR 0091) until the Guest Protection Fund is activated.
- **AC4:** Reviewed `D23`–`D32` against all governing ADRs (`0014`, `0016`–`0021`, `0023` as amended, `0028`–`0030`, `0044`–`0046`, `0058`, `0060`, `0061`, `0074`, `0089`, `0091`, `0092`). None contradicts an accepted ADR, so no ADR amendment is required and no ADR file was edited.

Behavioural verification run on `docs/app-expansion` against the real domain classes (`node --import tsx`, in-memory/SQLite stores, 25 Nov 2026):
- `[THREW] 1. BookingAmendmentManager on Extended Stay (occupants): Error: Stay length exceeds the maximum Short Stay limit of 29 nights`
- `[OBS]   2. Cell 1: Extension requested -> Cancel -> Extension approve: reservation=cancelled, extension=approved, newCheckOut=2026-10-30`
- `[OBS]   3. Cell 2: Verified Access -> Reviewed Cancel -> Notice to End: reservation=cancelled, noticeRecorded=2026-08-14`
- `[OBS]   4. Cell 3/19: Period 2 in flight (check-in morning) -> Cancel -> Period 2 verify: reservation=cancelled, periodVerify=period_paid`
- `[OBS]   5. Cell 14: Extension waiting -> Period 2 paid -> Extension approve: period=period_paid, extension=approved, periodsNow=3`
- `[THREW] 6a. Cell 16: Notice recorded -> Guest cancel: Error: STALE_ACTION`
- `[OBS]   6b. Cell 16: Notice recorded -> Reviewed cancel: reservation=cancelled`
- `[OBS]   7. Cell 21: Period 2 in flight -> Extension approve -> Period 2 verify: extension=approved, periodVerify=period_paid`
- `[OBS]   8. Cell 22: Period 2 in flight -> Notice to End -> Period 2 verify: noticeNewCheckOut=2026-08-24, periodVerify=period_paid`
- `[OBS]   9a. Cell 25: Complaint open -> Extension approve: complaintOpen=true, extension=approved`
- `[OBS]   9b. Cell 26: Complaint open -> Period 2 pay: complaintOpen=true, periodVerify=period_paid`
- `[OBS]   10. Cell 4: Complaint open -> Cancel -> Complaint upheld: reservation=cancelled, complaint=upheld`
- `[OBS]   11. Cell 8/24: Short Stay Complaint open/upheld -> Change commit: complaintUpheld=true, amendment=committed, newTotal=60000`
- `[OBS]   12. Cell 15/23: Extended Stay Extension waiting & Period 2 in flight -> Complaint upheld -> Extension approve & Period 2 verify: complaintUpheld=true, extension=approved, periodVerify=period_paid`
