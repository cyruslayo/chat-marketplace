# 01 · Guest screen re-baseline

Status: ready-for-agent
Type: research
Blocked by: none
Phase: 0 (Batch A)
Applicable ADRs: 0078, 0080, 0081; guideline §5, §7, §12

## What to build

Re-baseline every guest screen on current `main` against the guideline's screen contracts (§5) and the approved Guest UI kit.

- Run `.scratch/guest-ui-consistency/capture-11-all.sh` (each screen group in its own process), light and dark, at 320, 390, 768 and 1280. Copy the outputs and findings to `.scratch/ux-guidelines/screenshots/01/`.
- For each §5 guest surface (Landing through Expired/declined), compare the capture with its contract: visible hierarchy, a single primary action, and essential recovery. Also compare it with the design renders in `.scratch/guest-ui-consistency/design/`.
- Note whether the chat and standard-route renderings show the same facts and command (ADR 0080).
- Record one matrix row per observation.

## Acceptance criteria

1. Captures exist for every §5 guest surface at the four widths, in both themes
2. Every §5 guest surface has at least one matrix row, or a row saying the walkthrough cannot reach it
3. Chat and standard-route parity is recorded for each surface that has both
4. No code, CSS or copy file is changed

## Rules

- Research only: change no code, CSS, copy or tests. Phase 0 authorises no redesign (guideline §15).
- Synthetic data only. Never open `staging-secrets.env` or print the environment; prefix commands with `env -u LLM_API_KEY`.
- Run only one capture sweep or browser suite at a time. Delete any walkthrough log you create.
- Write matrix rows into `.scratch/ux-guidelines/evidence/01-rows.md` (column header from `evidence-matrix.md`; 05 merges them), keeping what you saw (Observed) separate from what it means (Priority).
- Do not commit. The orchestrator reviews the work and commits it.

## Comments
