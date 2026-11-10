# 08 · One money format and the glossary labels

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 1 (Batch A)
Applicable ADRs: 0015 (all-in pricing), 0080; guideline §9, §10

## What to build

- `apps/web-agent/src/deposit-claim-a2ui.ts:6` prints "NGN 1,234.00" through `toLocaleString`, and shows raw `status` and `noClaimRefundStatus` values. Use `formatMoney` (`apps/web/src/ui-kit.ts:34`) and map the statuses to guest words held in `guest-content.ts`.
- `apps/local-guest/src/assistant/pending-action-a2ui.ts:85,94` use "Stay Total" and "Refundable Deposit". Use the `GUEST_GLOSSARY` and `GUEST_FACT_LABELS` terms ("All-In Stay Total", "Refundable Security Deposit").
- Add a test that fails if any guest A2UI builder formats kobo without `formatMoney`.

## Acceptance criteria

1. Deposit-claim amounts use the same ₦ format as every other guest money value
2. Deposit-claim statuses show guest words, never raw enum values
3. Pending-action surfaces use the glossary money labels
4. The format-guard test fails on a builder that calls toLocaleString on kobo

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Assistant path: read ADR 0106 in full first. Tests run with the assistant runtime enabled and a cold restore (a new `LocalGuestApp` over the same store) before every event, on a fresh thread, with a staging-like clock (2026-10-27) and guest. `test/assistant-cold-journey.test.ts` is the model.

## Comments
