# 02 · Reclassify the older audit findings

Status: ready-for-agent
Type: research
Blocked by: none
Phase: 0 (Batch A)
Applicable ADRs: 0078; guideline §1 (evidence categories)

## What to build

Re-check each older audit finding on current `main` and classify it as fixed, current, partial or unverified, with evidence.

- Design audit A1 to A18: `docs/design/shortlet-ui-ux-audit.md` (table near lines 77 to 94).
- Browser audit 01 to 17 (B01 to B17 in the matrix): `docs/design/guest-browser-audit-2026-11-03.md`.
- Use the walkthrough (`.scratch/guest-ui-consistency/walkthrough.ts`) and the 01 captures. Use code only where a screen cannot be reached, and mark that row "unverified (code only)".

Hypotheses from reading the code on 10 Nov 2026, to confirm or refute:
- **Probably fixed:** A1, A10, A12, A14, B08, B10, B13, B15.
- **Partial:** A2, A3, A5, A6 (Operator dates still ISO), A7 (still "disclosed" in `guest-content.ts:70`), B07.
- **Open:** A16, B04 (`guestInspectionDisclosure`), B14 (`shortlet-app.ts:1134`).
- **Unknown:** A4 photos, A8 DOM label, A9, A11, A13, A18, B01, B02, B03, B06, B09, B11, B12, B16, B17.
- A17 is a tooling note, not a product finding.

## Acceptance criteria

1. All 18 design-audit findings and 17 browser-audit findings have a matrix row with a status and an evidence path
2. Every finding still current or partial cites the guideline rule it breaks
3. No code, CSS or copy file is changed

## Rules

- Research only: change no code, CSS, copy or tests. Phase 0 authorises no redesign (guideline §15).
- Synthetic data only. Never open `staging-secrets.env` or print the environment; prefix commands with `env -u LLM_API_KEY`.
- Run only one capture sweep or browser suite at a time. Delete any walkthrough log you create.
- Write matrix rows into `.scratch/ux-guidelines/evidence/02-rows.md` (column header from `evidence-matrix.md`; 05 merges them), keeping what you saw (Observed) separate from what it means (Priority).
- Do not commit. The orchestrator reviews the work and commits it.

## Comments
