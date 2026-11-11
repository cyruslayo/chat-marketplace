# 04 · Staging live journey and accessibility audit

Status: ready-for-agent
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
