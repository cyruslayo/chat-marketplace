# 04 · Staging live journey and accessibility audit

Status: ready-for-human
Type: research
Blocked by: none
Phase: 0 (Batch A)
Applicable ADRs: 0041, 0042, 0078, 0105, 0106; guideline §6, §12

## What to build

Run one full guest journey on the staging origin in the built-in browser, with synthetic data only (placeholder phone `+234 801 234 5678`). Follow the order in AGENTS.md "Live verification in the browser".

- **Timing:** start in Lagos daytime hours (Operator Active Hours) and allow for the 20-minute Payment Window. The owner picks the time slot, which is why this is ready-for-human.
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
- Write matrix rows into `.scratch/ux-guidelines/evidence-matrix.md`, keeping what you saw (Observed) separate from what it means (Priority).
- Do not commit. The orchestrator reviews the work and commits it.
- The only allowed `cf` call is a read-only log query, and only when the owner asks.

## Comments
