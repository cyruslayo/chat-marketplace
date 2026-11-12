# 33 · Pending-state recovery and the transfer payee name

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 1 (follow-up from Phase 0; owner approved 12 Nov 2026)
Applicable ADRs: 0080 (chat and standard-route parity), 0044 (Payment Window), 0047 (transfers), 0078 (accessibility); guideline §5 Request sent and Payment pending, §10

## What to build

Matrix rows 41, 58 and 59 (`.scratch/ux-guidelines/evidence-matrix.md`).

- **Request sent (standard route, row 41):** add a status check as the primary action, reading the server's current state. Keep "Back to your conversation" as a secondary action.
- **Payment pending, bank transfer (row 59):** make a payment-status check the single primary action. "Complete local demo transfer" stays demo-only and secondary.
- **Provider transfer page (row 58):** show the payee account name, but only when the projection carries an authoritative name. If no authoritative source exists, stop and record the question for the owner in Comments. Never invent a name.

## Acceptance criteria

1. The standard Request sent page offers a status check as its primary action, and the result reflects the server's current state
2. The bank-transfer pending page has one primary action, a payment-status check
3. The provider transfer page shows the payee account name from an authoritative projection field, or the issue records that none exists and the owner decides
4. Chat and the standard route show the same facts and commands for these states (ADR 0080)

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- UI change: end with captures at 320, 390, 768 and 1280 and the overflow and 44px checks (AGENTS.md "Guest UI work"), saved under `screenshots/33/`.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.

## Comments
