# 01 · Guest screen re-baseline

Status: resolved
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

**Setup (12 Nov 2026, worktree `C:/AI2026/chat-marketplace-p0-01`, detached at 4f36ce0)**
- `git -C C:/AI2026/chat-marketplace worktree add C:/AI2026/chat-marketplace-p0-01 4f36ce0 --detach`
- Junctions (PowerShell `New-Item -ItemType Junction`) for `node_modules` and `apps/cloudflare/node_modules`.
- `env -u LLM_API_KEY npm run build` (exit 0). It changed line endings only in `apps/cloudflare/public/_headers` and `apps/local-guest/dist/{client,gallery,landing,offer,payment}.js`. `git diff --ignore-cr-at-eol` is empty. Do not commit these.
- One stray command: `ln -s x /dev/null` (run with `2>/dev/null`) failed harmlessly because `/dev/null` already exists. It created nothing.

**Sweep**
- `env -u LLM_API_KEY sh .scratch/guest-ui-consistency/capture-11-all.sh`, one process at a time, log at the scratchpad `sweep.log`. It prints `FINISHED`. 21 groups (the script's list), 33 `captured` lines.
- Output: 264 PNGs in `.scratch/guest-ui-consistency/screenshots/final` (light and dark, 320, 390, 768, 1280), copied to `.scratch/ux-guidelines/screenshots/01/` with 21 `findings-*.txt` and `sweep-run.log`.
- Findings: no horizontal overflow in any group. The only small-control findings are hidden native radio inputs (1x1) in the payment-choice groups, which AGENTS.md records as expected.
- The sweep overwrote 277 tracked files under `.scratch/guest-ui-consistency/screenshots/final`. I restored them to HEAD with `git checkout --` in this worktree; the regenerated copies are in `screenshots/01/`.
- `no-reservation` has no chat capture (the script logs "no chat workspace for this stage").
- No walkthrough log was created. No browser process ran outside the sweep.

**Could not reach (reason)**
- Extended Stay schedule (`/bookings/periods/:offerId`): no sweep group. `capture-27.ts` is a commerce store and offer script, out of scope, not run. `.scratch/ux-guidelines/screenshots/27/` holds older offer and payment captures only. Needs a capture group in a later issue (matrix row 26).
- Operator inbox and detail: not in the guest sweep; issue 03 covers them (row 27).
- Bank transfer and manual transfer in chat: the chat captures show the card-checkout stage, so the transfer states were not reached in chat (row 29).
- Landing: only a chat capture exists; there is no standard landing route in the sweep.
- Not verified: draft save and reopen, and retention of search criteria on expired and declined.

**Acceptance criteria**
1. Captures for every §5 guest surface, four widths, both themes: done for Landing through Expired/declined (`screenshots/01/`). Not done for the Extended Stay schedule (not reached).
2. Every §5 surface has a matrix row or a reach note: done (`evidence/01-rows.md`, rows 1 to 32; rows 26, 27 and 29 are reach notes).
3. Chat and standard-route parity recorded: done for discovery, unit detail (gap, row 1), request sent, draft, review, declined, expired, offer, offer expired, payment choice, confirmed (rows 6, 7, 12, 18, 22, 25, 28, 30, 31, 32). Not done for no-reservation and the bank and manual transfer states (rows 21, 29).
4. No code, CSS or copy changed: done. `git status` shows only `.scratch/ux-guidelines/` additions and the build line-ending changes above.

**Visual review.** I viewed the 390 light captures for every surface, plus 320 light and 1280 dark spot checks. Dark and 768 captures rely on the sweep's overflow and 44px audit. Summary: the request, offer, payment and confirmation screens have a clear status, one primary action and absolute WAT deadlines. Main issues, all provisional: the standard unit page has no Request to Book action (row 1, P1); the confirmed screen states a ₦20,000 deposit as collected while the paid total is the stay alone (row 22, P0 until verified against the payment record); the raw booking reference is shown (row 23); there is no status check on pending payment or on the standard request-sent page (rows 11, 19). The owner's approved "Total to complete booking" label was not flagged.

**Status.** Sweep finished (`FINISHED` in `sweep.log`). Captures are free for the next agent. The issue Status is unchanged (ready-for-agent). Nothing is committed.

### Orchestrator review (12 Nov 2026)

- Row 1 (P1) confirmed on staging: `/stays/demo-unit-ikoyi` has no Request to Book; its only action, "Continue to Request to Book", links to `/` and opens no draft for this stay.
- Row 22 (provisional P0) is not a defect: the "Refundable Security Deposit collected" line appears only when the projection marks the deposit `held`, and the walkthrough's confirmed stage paid the deposit as a separate payment.
- Gaps carried to 05: no capture of the Extended Stay schedule (`/bookings/periods/:offerId` has no sweep group), and no chat-and-standard parity for the no-reservation and bank/manual transfer states.
