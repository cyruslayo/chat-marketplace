# 05 · Consolidate the evidence matrix and set priorities

Status: resolved
Type: task
Blocked by: 01, 02, 03, 04
Phase: 0 (Batch A)
Applicable ADRs: guideline §14; every ADR cited in the matrix rows

## What to build

Merge the rows from 01 to 04, remove duplicates, and assign P0 to P3 (§14).

- Confirm, re-scope or drop issues 12 and 20 (both blocked by this one), and any issue from 06 to 31 that the evidence contradicts.
- List any new P0 or P1 finding as a proposed issue title. Do not write the issue files until the owner approves.
- Record the owner decision of 12 Nov 2026 on the vocabulary conflict: the guest label stays "Total to complete booking" (`GUEST_FACT_LABELS.amountDueNow`) and carries the glossary meaning of Amount Due Now. Rows that flag the guideline wording are not a defect; do not propose a rename.
- Write a short summary at the top of `evidence-matrix.md`: counts by priority and by surface.

## Acceptance criteria

1. Every matrix row has a priority and either an issue number or the label "no action"
2. The decision on issues 12 and 20 (confirm, re-scope or drop) is recorded in their Comments
3. The Amount Due Now decision (keep "Total to complete booking", 12 Nov 2026) is applied to the matrix and noted in map.md

## Rules

- Docs only. Do not commit. The orchestrator reviews the work and commits it.

## Comments

**Run (12 Nov 2026).** Worktree `C:/AI2026/chat-marketplace-p0-05` (detached at e74c550). Docs only: no build, no tests, no code, no CSS, no copy. Nothing committed; no issue Status changed. No issue files created.

**Matrix.** `evidence-matrix.md` now holds 96 rows from 104 source rows (01: 32, 02: 38, 03: 13, 04: 21). Summary at the top gives counts by priority and surface. Merged duplicates: the raw booking reference (01#23, 01#32, 04#18); terms and house-rule presentation (01#15, 02#11, 02#25, 02#29, 04#15); inspection trust (02#5, 02#22); scroll owners (02#20, 02#35). Every row has a priority (or `—` for a conforming row or coverage note) and an issue number, `proposed:` title or `no action`.

**Priorities.** P0: none. P1: 1 (row 22). P2: 19. P3: 28. `—`: 48. (Orchestrator review below lowered rows 1 and 45.)

### Proposed P0 and P1 issues

1. **Show the demo notice on the chat landing and workspace.** Row 1 (P1, raised from P2). Build a persistent demo label on the chat shell and results on public staging (§10). Check the staging DOM first: if the notice is present, row 1 becomes no action.
2. **Standard Unit detail: Request to Book as the primary action.** Row 22 (P1). No new file: folded into issue 20 (AC2 and AC3). Build Request to Book as the primary action on `/stays/<id>`, at parity with the chat unit view.
3. **Verify the Offer identity house-rule wording against policy.** Row 45 (P1, raised from P2). The owner confirms that "Guest identity verification is required before access" and the ID comparison line have a policy source (ADR 0085 bars identity verification before an offer). If not, rewrite or remove; an unsupported guest-facing contract claim is P0 under §14.

### Proposed P2 issues (grouped, six titles)

1. **Pending-state recovery:** a status check on Request sent and Payment pending, one primary action on the bank-transfer pending page, and the payee name on the provider transfer page (domain decision). Rows 41, 58, 59.
2. **Terms presentation:** house rules and conduct as a list behind a disclosure on Offer and the confirmed page, in plain language; all terms stay available. Rows 45, 46.
3. **Reopen 14: focus and announcements** after each workspace change, and an announcement for the offer and payment screens. Rows 52, 53 (P2) and 15 (P3, task-naming H1).
4. **Reopen 21: Cancel hidden until the still-working threshold.** Row 5.
5. **Reflow at 320 px and 200% zoom:** no mid-word breaks, money on one line. Rows 24, 73 (P2); rows 23 and 25 (P3). Captures at 320 and 200%.
6. **Operator detail: Guest name and the after-confirm next step.** Rows 84, 88.

P2 rows already on an issue: 9, 10, 26, 28 (issue 20); 70 (issue 12); 4 (issue 31, B01 first-message check).

### Issue 20 and 12 decisions

Both are recorded in their Comments (`issues/12-…` re-scoped, rows 2, 8, 14, 16, 21, 30, 33, 35, 39, 50, 70, 96; `issues/20-…` re-scoped, rows 6, 7, 9, 10, 22, 26, 28).

### Contradictions with issues 06 to 31

- **21 (cancellable turn):** row 5. Cancel is visible at rest on the chat root (`#turn-cancel` hidden attribute overridden by `.ui-button`). Reopen 21.
- **14 (focus and announcements):** rows 15, 52, 53. The H1 reads "Booking details" while browsing, focus lands on "Back to conversation" after every workspace change, and the offer and payment screens are not announced. Reopen 14.
- **13 (accessibility labels):** row 16. The View control's accessible name repeats the verb, although 13 applied A2UI labels. Partial.
- **16 (native dialog):** row 72. The detail sheet is not `aria-modal` and the page behind it stays reachable. 16 found no guest A2UI Modal, which is still true, but the sheet behaves like a modal without modal semantics. Clarify before 16 is treated as closed.
- **06 (internal terms and raw IDs removed):** row 70 (raw `res_cmd_...` references on the confirmed screen) and row 21 (offline assistant "has been disclosed"). Both contradict 06's record.
- **26 (Operator clarity):** rows 84 and 88. The detail has no Guest name and the after-confirm state gives no next step. 26's human dates and status labels are confirmed (rows 79 to 83); these two gaps are not.
- **23 (images and alt text):** row 30. Alt text doubles the place name on the photo.
- **08 (money format):** row 24. The deposit line may split "₦20,000" across a wrap. Not yet a contradiction; confirm in the DOM (issue 31 check).
- **31 (release sign-off):** row 22 is the only open P1, so 31 cannot sign off until they are resolved or dropped (31 is blocked by every open P0 and P1). Rows 4, 13, 18, 27, 31, 63, 65, 67, 94 and 95 are checks to run before sign-off.
- **27 and 28 (Extended Stay):** row 94 (schedule not captured). A coverage gap, not a contradiction.
- **09 (dates), 15 (skip links), 17 (targets), 18, 19, 25 (composer), 07 (payment callback), 10:** consistent with the staging run (rows 3, 26, 29, 43 and 62).
- **30 and 32 (funnel events):** no defect rows; none of the matrix rows points to 32.

### Amount Due Now decision (12 Nov 2026)

Applied. The guest label stays "Total to complete booking" (`GUEST_FACT_LABELS.amountDueNow`). Row 34 (draft and review totals) is no action. Row 55 (payment choice total) conforms. Row 25 flags spacing only ("₦390,000Total to complete booking"), not the wording, and is P3 in the reflow group. `map.md` records the decision in Context pointers.

### Acceptance

1. Every row has a priority and an issue or `no action`: done (96 rows).
2. Issues 12 and 20 decisions recorded in their Comments (re-scoped): done.
3. Amount Due Now decision applied to the matrix and noted in `map.md`: done.

### Orchestrator review (12 Nov 2026)

- **Row 1 (demo notice): no action.** Staging shows "Demo: illustrative listings, not live bookings…" (`role=note`) at the top of the chat. The local captures lack it only because the local fixture runs with the demo setting off. Proposed issue 1 above is withdrawn.
- **Row 45 (identity wording): P2, not P1.** "presents approved credential/photo ID for visual comparison" comes from ADR 0059 (`guest-conduct.ts:80`), and "verification is required before access" (`guest-content.ts:366`) fits ADR 0085 (verification at pre-arrival, arrival or check-in). It is policy-backed; only the plain-language presentation remains, folded into the Terms presentation P2. Proposed issue 3 above is withdrawn.
- **Result:** the only P1 is row 22, the standard unit page without Request to Book, which issue 20 covers.
