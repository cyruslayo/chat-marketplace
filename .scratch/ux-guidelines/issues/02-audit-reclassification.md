# 02 · Reclassify the older audit findings

Status: resolved
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

Worktree: `C:\AI2026\chat-marketplace-p0-02` at 4f36ce0 (detached). Rows: `.scratch/ux-guidelines/evidence/02-rows.md` (38 rows: findings A1 to A18, B01 to B17, and new N1 to N3). Snapshots and logs: `.scratch/ux-guidelines/evidence/02-snapshots/`.

### Commands run

- `env -u LLM_API_KEY npm run build` at the worktree root, once, after the two junctions. Exit 0. It rewrote the git-ignored output and the line endings of tracked `apps/cloudflare/public/_headers` and `apps/local-guest/dist/*.js`. Those are build artefacts, not part of this issue, and are not committed.
- `env -u LLM_API_KEY npm run check`: exit 0 (`evidence/02-snapshots/npm-run-check.log`).
- `env -u LLM_API_KEY npx tsx --test` on 20 non-browser files: `operator-detail-clarity`, `guest-internal-terms`, `guest-date-format`, `guest-money-format`, `guest-skip-link`, `guest-kit-targets`, `extended-stay-counsel-copy`, `payment-callback-page`, `a2ui-accessibility`, `guest-modal-usage`, `guest-focus-announcements`, `guest-image-layout`, `guest-surface-hooks`, `discovery-budget-note`, `guest-changed-elsewhere`, `guest-recovery-regression`, `guest-turn-cancel`, `guest-long-conversation`, `guest-composer-sizing`, `extended-stay-schedule`. Result: 66 tests, 66 pass, 0 fail (`evidence/02-snapshots/unit-tests-run.log`). No `-chromium` or real-browser file was run.
- HTTP probe: a throwaway script in `C:\Users\Cyrus\AppData\Local\Temp\p0-02\`, run with `npx tsx`. It used `withStagePage` / `BOOKING_STAGE_PAGES` (8 standalone pages: review, request sent, offer, expired offer, payment choice, provider transfer, manual transfer, confirmed) and `restartFixture` (chat discovery, View apartment event, zero-results search, `/welcome`, `/guest/contact`, an invalid phone POST, card handoff POST, `/welcome/start`). Ephemeral ports only. No capture script, real-Chrome test, or fixed-port walkthrough (3021+) was run. Output saved to `evidence/02-snapshots/`. The script folder is deleted after this comment.
- Read-only input: `docs/design/guest-browser-audit-2026-11-03.md` is untracked and is not in 4f36ce0, so it was read with `cat` from the main checkout (`C:\AI2026\chat-marketplace\docs\design\`). Nothing was written there. The worktree copy will be needed for commit review.

### What could not be reached, and why

- Issue 01 captures (`C:\AI2026\chat-marketplace-p0-01\.scratch\ux-guidelines\screenshots\01\`): the folder did not exist when checked. Visual rows A2, A3, A9, A13, B02, B06 and B17 are "unverified (code only)" and must be re-checked when the captures land.
- Browser checks (accessibility tree, keyboard, focus, 320/390/768/1280 layout, 200% zoom, touch targets): not run, because the brief forbids real-browser work during the sweep. Affects A8 (AX name), B06 (double numbering), B02 and B17 (scrollbars).
- Live hosted Paystack handoff, real provider return, pending reconciliation and live expiry: the fixture is local (`localPayment: true`). The ADR 0046 gap was not induced.
- Operator pages: no Operator fixture was fetched. A12, A13 and A15 rest on code plus the issue 26 test file.
- A14 and A16: the Gemini quota state was not induced. A16 rests on `guest-recovery-regression` plus code.
- B01: a fresh guest's message was checked only up to the 303 redirect to `/conversation`. Whether the message appears in the new thread is not verified.
- B05: the standalone review edit controls were read. Chat review edit controls were not.

### Summary

- Design audit A1 to A18: fixed 6 (A6, A7, A8, A10, A14, A15); partial 8 (A1, A4, A5, A9, A11, A12, A16, A18); unverified 3 (A2, A3, A13); not a product finding 1 (A17).
- Browser audit B01 to B17: fixed 6 (B03, B05, B08, B09, B10, B16); partial 5 (B07, B11, B13, B14, B15); current 2 (B04, B12); unverified 4 (B01, B02, B06, B17).
- Totals: fixed 12, partial 13, current 2, unverified 7, not a product finding 1.
- New observations: N1 (offer house-rule wording on identity: owner check, P2), N2 (redundant "Bedrooms: 2 bedrooms" and "Sleeps: Sleeps 4" labels, P3), N3 (offline scripted reply uses the forbidden term "has been disclosed", P3).

Checks of the 10 Nov hypotheses on the current tree:
- Probably fixed: A10, A14, B08, B10 confirmed fixed. A1, A12, B13 and B15 are not fully fixed: A1 is partial (landing fixed, shell title still "Shortlet Concierge"), A12 is partial (detail action area not fixed), B13 and B15 are partial.
- Partial: A6 and A7 are fixed (WAT text only; "disclosed" gone from guest copy). A5 is partial. A2 and A3 are unverified (code only). B07 is partial.
- Open: A16 is partial (tests cover the states; live states not induced). B04 is current. B14 is partial (summary fixed; the assistant text still says "You can view the details below").
- Unknown, now resolved: A4 partial, A8 fixed, A9 partial, A11 partial, A13 unverified, A18 partial, B01 unverified, B02 unverified, B03 fixed, B06 unverified, B09 fixed, B11 partial, B12 current, B16 fixed, B17 unverified.

Acceptance criteria:
1. All 18 design-audit and 17 browser-audit findings have a row with a status and evidence path: done (`evidence/02-rows.md`, rows 1 to 35).
2. Every current or partial finding cites a guideline rule: done (column "Guideline rule (§)").
3. No code, CSS, copy or test file changed: done. Only `.scratch/ux-guidelines/evidence/02-rows.md`, `.scratch/ux-guidelines/evidence/02-snapshots/` and this Comments section were written. Build artefacts are the only other changes (see above).

Not committed. Status not changed.
