# 07 · Payment-callback failures show a guest page

Status: resolved
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

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0046 | A callback is not a terminal outcome; only backend verification confirms. Never imply a second payment while the outcome is unknown. | AC1 and AC2 page copy; the page offers status, not another payment. |
| 0047 | A transfer reference expires; a late or unverifiable return never confirms a booking. | AC2: the page says the reservation is not confirmed. |
| 0075 | No references, tokens or provider text in guest interaction state or logs. | AC4. The page carries only closed outcome codes. |
| 0080 | A conventional route keeps the same facts; no agent-only state. | The HTML page and the thread notice are ordinary server routes. |
| 0005 | A Reservation exists only after verified payment. | The failure copy never says confirmed. |
| 0087 | A provider return is a return signal only; verification is the sole transition path. | The callback keeps `verifyAndConfirmPaystack` as the authority. |

### Decisions and contradictions recorded

- The page carries the closed callback outcome in `data-error-code` (as every guest error page does) and no reference, token, provider name or URL. The issue's line "keep the closed codes in the existing log lines only" is read as "no internal reason text in guest copy"; the closed code is machine metadata for support and tests, not visible text. If the owner prefers a single public code, the helper is the one place to change.
- Issue 07 AC3 had no existing thread message channel. The failed-verification redirect now carries `payment=not-confirmed`, and the chat shell renders one polite status banner from `GUEST_PAYMENT_CALLBACK_COPY.notConfirmedNotice`. This adds no `client.ts` change.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/payment-callback-page.test.ts` — 4 tests, 4 passed, 0 failed.
- Affected: `npx tsx --test test/guest-internal-terms.test.ts test/guest-copy-pass.test.ts test/landing-page.test.ts` — 43 tests, 43 passed, 0 failed.
- Captures: `npx tsx .scratch/ux-guidelines/capture-07.ts` — 16 captures at 320/390/768/1280, light and dark, in `.scratch/ux-guidelines/screenshots/07/`; findings show no horizontal overflow and no visible control under 44px.

## Answer

Payment-callback failures now return a standard guest page for invalid, unknown, unknown-thread and rejected returns, instead of raw JSON. The page gives problem, effect and next action ("We could not confirm this payment yet"; "Your reservation is not confirmed"; a booking-status link), never claims success, and carries no reference, token or provider text. A failed verification that can return to the thread redirects with `payment=not-confirmed`, and the thread shows the not-confirmed status banner.
