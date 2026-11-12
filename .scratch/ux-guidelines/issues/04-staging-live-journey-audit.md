# 04 · Staging live journey and accessibility audit

Status: resolved
Type: research
Blocked by: none
Phase: 0 (Batch A)
Applicable ADRs: 0041, 0042, 0078, 0105, 0106; guideline §6, §12

## What to build

Run one full guest journey on the staging origin in the built-in browser, with synthetic data only (placeholder phone `+234 801 234 5678`). Follow the order in AGENTS.md "Live verification in the browser".

- **Timing:** start between 8:00 AM and about 6:30 PM WAT (UTC+1), so the Booking Request can be submitted inside Operator Active Hours (8:00 AM to 7:30 PM WAT) and the 20-minute Payment Window fits after Accept Offer.
- **Owner handoff (11 Nov 2026 decision):** the agent drives every step up to the Paystack hosted checkout, then stops and tells the owner. The owner pays with the published test card and says when it is done; the agent then checks the confirmation screen. The owner confirms in the Paystack dashboard that `charge.success` was delivered with a 200.
- **Stop before card entry on Paystack.** The owner pays with the published test card. Afterwards, check the confirmation and that the webhook was delivered.
- **Accessibility pass** on the same journey: keyboard-only path, focus after each workspace change, 200% zoom at 390, and the accessibility tree (`read_page`) for the names of every primary action.
- **Slow model:** note what the guest sees while waiting for a turn (§6, turn behaviour).
- **On any defect,** record the exact `/api/event` or `/api/turn` response body, the step, and the expected behaviour.

## Acceptance criteria

1. The journey is recorded step by step up to confirmation, or to the step where it stopped, with the reason
2. Every primary action has its accessible name recorded from the accessibility tree
3. The keyboard-only and 200% zoom observations are in the matrix
4. No card data is entered by the agent

## Rules

- Research only: change no code, CSS, copy or tests. Phase 0 authorises no redesign (guideline §15).
- Synthetic data only. Never open `staging-secrets.env` or print the environment; prefix commands with `env -u LLM_API_KEY`.
- Run only one capture sweep or browser suite at a time. Delete any walkthrough log you create.
- Write matrix rows into `.scratch/ux-guidelines/evidence/04-rows.md` (column header from `evidence-matrix.md`; 05 merges them), keeping what you saw (Observed) separate from what it means (Priority).
- Do not commit. The orchestrator reviews the work and commits it.
- The only allowed `cf` call is a read-only log query, and only when the owner asks.

## Comments

### Run (12 Nov 2026, 10:00 to 10:15 AM WAT)

Staging `https://shortlet-pilot-staging.khayutsefi.workers.dev` at main `c6a7961`, driven by the orchestrator in the Claude desktop built-in browser. Synthetic data only (phone `+234 801 234 5678`, email `demo.guest@example.com`). The agent entered no card data; the owner paid with the published test card at the Paystack hosted checkout.

Journey (AC1): search → 6 Lagos results → Old Ikoyi detail → Request to Book → Review request → phone saved → Submit Booking Request → Conditional Booking Offer (the staging demo Operator confirms automatically) → Accept and choose payment → email saved → standalone payment page → Paystack hosted checkout → owner paid → return verified → "Reservation confirmed · Stay payment verified". No step failed and no `/api/event` or `/api/turn` error was returned.

Primary-action accessible names (AC2), from the accessibility tree: "View apartment: View Demo Two-Bedroom Apartment in Old Ikoyi" (verb repeated, row 5), "Request to Book Demo Two-Bedroom Apartment in Old Ikoyi", "Review request", "Save phone number", "Submit Booking Request", "Accept and choose payment", "Continue to stay payment · ₦390,000", "Save email address", "Continue to hosted card checkout", "Ask about arrival". Every one is at least 44px tall.

Keyboard-only and 200% zoom (AC3): rows 19 and 20 of `evidence/04-rows.md`.

Not observed: a slow turn (all turns under 4 s), so the "still working" copy and Cancel were not checked live (row 21). The owner confirms the `charge.success` webhook delivery (200) in the Paystack dashboard.

Findings: 21 rows in `.scratch/ux-guidelines/evidence/04-rows.md`; provisional P2: the always-visible Cancel button (issue 21 regression), unannounced offer and payment screens, the dense guest-conduct list, and mid-word breaks at 200% zoom. The rest are P3 or confirmations.
