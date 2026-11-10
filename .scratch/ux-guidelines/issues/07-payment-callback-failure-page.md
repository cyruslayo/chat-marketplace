# 07 · Payment-callback failures show a guest page

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 1 (Batch A)
Applicable ADRs: 0046, 0047, 0075 (no ids or provider text in logs), 0080; guideline §9 microcopy, §10, §12 slow network

## What to build

`/payments/paystack/callback` (`apps/local-guest/src/guest-server.ts:5049-5159`) sends raw JSON codes to the browser (`PAYMENT_CALLBACK_INVALID`, `PERIOD_PAYMENT_CALLBACK_REJECTED`, `PAYMENT_CALLBACK_UNKNOWN`, `PAYMENT_CALLBACK_THREAD_UNKNOWN`). A failed verification also redirects to the thread with no message.

- Render a standard guest page (`pageShell`, kit banner) that gives problem, effect and next action, for example: "We could not confirm this payment yet. Your reservation is not confirmed. Check your booking status." Link to the authoritative booking route.
- Keep the closed codes in the existing log lines only (ADR 0075).
- Never claim success, and never offer a second payment while the outcome is unknown.

## Acceptance criteria

1. An invalid, unknown-thread or rejected callback returns an HTML guest page, not JSON, with a link to the booking status
2. The page never says the payment or reservation succeeded
3. A failed verification that redirects to the thread shows a not-confirmed status message there
4. No reference, token or provider text appears in the page or the logs

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments
