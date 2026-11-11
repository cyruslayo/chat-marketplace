# 31 · UX release sign-off

Status: needs-triage
Type: task
Blocked by: 29 and every open P0/P1 issue
Phase: 5 (Batch E)
Applicable ADRs: guideline §14; all ADRs cited by the resolved issues

## What to build

- Re-run the critical study tasks with new participants after the P0 and P1 fixes.
- Run the pre-merge gates once.
- Write `.scratch/ux-guidelines/sign-off.md`: the evidence, known P2 and P3 issues, and the business and legal gates still open (for example the ADR 0092 counsel text).

## Acceptance criteria

1. No open P0 or P1 row remains in the matrix
2. The pre-merge gates pass, apart from the known accepted failures in AGENTS.md
3. The sign-off report lists the open gates and the owner's approval

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.

## Comments
