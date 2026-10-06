# Payment screens: choice, card, bank transfer, manual transfer, waiting, no reservation

Status: resolved
Type: task
Blocked by: 08
Requested: 29 Sept 2026

## Why

Payment has the most screens and the most drift:
- the chat's card-payment and bank-transfer surfaces (`card-payment-a2ui.ts`, `bank-transfer-a2ui.ts`), with the blue "Time left to pay" `.waiting-panel`
- the payment page in the `/payments/offers/:id` handler, with its three stacked method buttons from `transferChoiceHtml`
- `renderTransferPageHtml`, `renderManualTransferPageHtml` and their states: "Payment received", "Your transfer is processing", "Waiting for payment check", "This transfer account has expired", "No Reservation was made"

The design (`design/PaymentChoice`, `CardHandoff`, `BankTransfer`, `ManualTransfer`, `PaymentWaiting`, `NoReservation`) gives them one layout: the deadline banner, then the ticket, then the breakdown, then one details card.

## What to build

- **Payment choice.**
  - head, the deadline banner, the ticket, and the breakdown with the "Next payment · stay payment ₦…" row
  - "How would you like to pay?": a `.ui-segmented` **radio group** (Card / Bank transfer) plus one submit, so it works without JavaScript
  - the manual bank transfer option stays offered below as its own action (ADR 0090)
  - a single `POST` handler that dispatches to the **existing** method handlers or commands (card continue, provider transfer, manual transfer), with no new domain behaviour. An unknown or missing method fails closed with the existing error page
  - the note "you can't switch to card until the transfer account expires" stays (existing copy)
- **Card handoff:** the existing "Payment handoff" surface and `/continue`: the banner, the ticket, the "This payment · stay payment ₦…" row, the handoff explanation (existing copy), "Pay ₦… by card", and "Choose another way to pay".
- **Bank transfer** (provider account): the banner ("Transfer by …"), the ticket, one `bankDetailsHtml` card (exact amount, bank, account number with the copy button from d2dfced, the booking-only note), a status pill "Waiting for your transfer", and "Back to your conversation".
- **Manual transfer:** as bank transfer, plus the account name and booking reference, the "receipt alone doesn't confirm it" sentence, and an upload card (`.ui-upload` label wrapping the real file input; the form and limits are unchanged).
- **Waiting states** ("Waiting for payment check", "Your transfer is processing", "Payment received"): a status pill, a neutral banner with the **real** verification deadline from the manual-transfer projection (the design's `[verification deadline]` placeholder), the ticket, and a transfer summary card (amount, reference, receipt time from the projection). If a value isn't projected, ask before adding it.
- **No reservation / expired account:** a danger pill, a danger banner with the absolute expiry time, the late-payment refund sentence (existing copy), then "Back to your conversation" and "Find other stays".
- **Chat surfaces:** replace `.waiting-panel` for payments with the banner plus `.ui-steps` (the outcomes from `guestWaitingGuidance`). The chat bank-transfer surface gets the same copy button, through the client (reversible presentation, ADR 0072).
- **Amounts and labels:** keep today's values exactly. Issue 12 may change what "Amount due now" means. If it is resolved before this ships, apply its answer; otherwise note it in `## Comments`.

## Acceptance criteria

- AC1 (accepted scope): The pending-payment screen shares its head, banner, ticket, breakdown and steps between chat and the conventional page. Provider/manual-transfer details, upload, waiting and recovery screens use the shared kit layout on standalone pages; transfer-screen chat parity is not required (user accepted the page-based flow).
- AC2: The payment choice works without JavaScript: choosing Card or Bank transfer and submitting reaches the same route and command as today, and manual bank transfer remains available. Failure path: a missing or unknown method is refused, and no payment attempt starts.
- AC3: Every payment deadline is a `.ui-banner--warning` with an absolute WAT time and the minutes left. No `.waiting-panel` or info-coloured box remains in payment surfaces.
- AC4 (accepted scope): The copy button copies the account number on the provider/manual-transfer pages and announces "Account number copied". Without JavaScript it stays hidden and the number is selectable text (keep the d2dfced Chromium test). No chat copy button is required (user accepted the page-based flow).
- AC5: The waiting screens show the verification deadline and receipt time from the projection, never a hardcoded value. The no-reservation screen shows the actual expiry time.
- AC6: Amounts shown equal the projection values used today on each screen (regression test), unless issue 12 was resolved first.

## Tests to update

`guest-payment-choice.test.ts`, `manual-transfer-with-receipt.test.ts`, `manual-transfer-copy-chromium.test.ts`, `provider-issued-transfer-account.test.ts`, `render-bank-transfer-weaver-a2ui.test.ts`, `expire-transfer-and-refund-late-payment.test.ts`, `guest-waiting-states-chromium.test.ts`, `paystack-real-browser.test.ts`.

## ADR compliance

0089, 0090, 0072, 0075 (no account data in URLs or logs), 0078, 0080.

## Comments

### Accepted scope

The user accepted the page-based transfer flow: chat retains the shared payment-ready screen; provider/manual-transfer account details, copy buttons, receipt upload and waiting states remain on standalone pages. Full transfer-screen chat/page parity and the chat account-copy button are not required for this issue. This explicitly accepts the AC1/AC4 deviations recorded below.

Implementation was committed as `dc306fb`; amount labels were settled in `c0db5d5`. The issue-11 close-out (`639e3cd`) records a clean typecheck and 1230 non-browser + 165 Chromium passes, one pre-existing skip and zero failures. The earlier formatting failures and uncommitted notes below are historical, not current blockers.

All seven Definition of Done items are verified below. Audit and final answer committed as `62a9e47` before recording resolution.

### Close-out audit

This is a tracker-only close-out of implementation `dc306fb`, amount-label follow-up `c0db5d5` and final acceptance `639e3cd`; no application code or domain policy is changed.

| ADRs re-read | Constraint verified | Acceptance / code path |
| --- | --- | --- |
| 0005, 0044, 0045 | A receipt/processing state is not a Reservation; projected deadlines and late-payment refunds remain authoritative | AC3/AC5; `paymentScreenContent`, transfer renderers |
| 0015, 0016, 0089 | All-in total and refundable deposit stay separate; display projected kobo values without changing prices | AC6; `priceBreakdownHtml`, `GUEST_FACT_LABELS` |
| 0046, 0047, 0049, 0087, 0088 | One live attempt; payable transfers cannot switch to card; fresh hosted card checkout and booking-specific transfer routes stay intact | AC2; method POST dispatches to existing `/continue` or `/transfer` |
| 0072, 0073, 0077, 0081 | Basic Catalog, server-bound actions and canonical presentation facts remain unchanged; client reorganization is presentation only | AC1/AC2; `cardPaymentArtifactToA2UI`, `organizePaymentScreen` |
| 0075, 0090 | Account configuration and receipt evidence remain protected; receipts cannot confirm a booking; verification timestamps come from the projection | AC4/AC5; `bankDetailsHtml`, manual-transfer renderer |
| 0078, 0080 | Absolute WAT deadlines plus minutes remaining, accessible optional copy enhancement and native no-JS payment/upload routes | AC2/AC3/AC4; kit helpers and conventional routes |

Definition of Done evidence (all seven items verified):

1. **Dedicated named tests:** `guest-payment-consistency.test.ts` has AC1, AC2, AC3, AC5 and AC6 tests; `guest-payment-consistency-chromium.test.ts` has AC1 chat/page parity, AC3 chat deadline and AC4 provider-copy tests. Each block targets one criterion. `manual-transfer-copy-chromium.test.ts` covers manual-copy success, failure and no-JS behavior. AC1/AC4 are explicitly narrowed to the user's accepted scope above, not claimed as full transfer chat parity.
2. **Failure paths:** AC2 tests missing, empty, unknown and combined methods plus cross-origin refusal and asserts no attempt/session starts. AC4 covers clipboard refusal and no-JS fallback. AC5 advances the clock through manual/provider expiry and verifies actual projected timestamps and no-Reservation/refund copy. Supporting payment-choice/manual-receipt tests refuse live-attempt switching, invalid/late/foreign uploads and receipt-only confirmation.
3. **ADR compliance:** re-listed and re-read as in the table; implementation commit `dc306fb` cites its eight governing ADRs. No accepted deviation overrides domain or deterministic-route authority.
4. **No unused injection:** issue 09 introduced presentation functions and typed data, not a new dependency-injected class; no new constructor dependencies to leave unused.
5. **No invented policy:** amounts/deadlines are read from artifacts or transfer projections; account and receipt limits are configuration. Switching, verification and refund wording comes from the ADRs/shared guest vocabulary; amount labels follow resolved issue 12.
6. **No sensitive logging:** the reviewed payment-layout/method-dispatch changes add no logging, telemetry or audit payloads. Bank numbers stay in authorized page content/clipboard data, not route URLs. `provider-issued-transfer-account.test.ts` checks account-number omission from audit; `manual-transfer-with-receipt.test.ts` checks receipt-name/bytes omission.
7. **Fresh verification passed:** `tsc --noEmit` (`npm run check`'s command) and `node scripts/run-tests.mjs` (`npm test`'s command) both exited 0. Full rerun: **1253 non-browser + 165 Chromium passes, 1 existing opt-in skip, 0 failures**. Only `PI_REASONING_LEVEL` was removed from the verification subprocess environment: the initial suite's identity-provider test falsely matched that harness variable name against `NIN`, reproduced in isolation (no values printed). The initial browser run also failed the app-frame no-JS navigation assertion; the unchanged test passed in the complete rerun. Both runs are reported rather than treating targeted retries as a green full suite. Suites ran sequentially; no application/test code was changed. Session logs: `%TEMP%/guest-ui-09-closeout-WOSyvG/{check-clean.log,test-clean.log,result-clean.json}`.

### Historical implementation notes

Implemented on the working tree; **not committed** (historical; subsequently committed as noted above). ADRs read: 0046 (one live attempt; switching rule kept), 0072 (chat action stays the Weaver server-bound event), 0075 (no account data in URLs/logs), 0078 (absolute WAT deadline + minutes left, 320px/44px), 0080 (native no-JS choice, manual option separate), 0088/0090 (card, provider transfer, manual transfer; money not receipt confirms), 0089 (amounts unchanged).

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0046/0088 | "can't switch to card" note stays, before the choice | `paymentChoiceHtml`, AC2 |
| 0072 | method POST only dispatches (303 `/continue`, 307 `/transfer`); chat button untouched | POST `/payments/offers/:id`, `organizePaymentScreen` |
| 0078 | every deadline `.ui-banner--warning` / danger with WAT time | `deadlineBannerHtml`, `paymentOutcomeBannerHtml` |
| 0090 | verification deadline and receipt time from `ManualTransfer` | manual waiting screen |

### Deviations / open points
- **Commit not made.** `guest-kit.ts`, `guest-server.ts`, `client.ts` and `shortlet-foundations.css` are wholesale reformatted vs HEAD in the working tree (pre-existing, also noted in issue 08). Committing needs the issue-08 style staged-hunk isolation; awaiting the user's call.
- Full suite on the working tree: 1221 non-browser + 161 Chromium pass; 6 failures, all exact-string CSS tests tripped by that pre-existing reformatting (`shortlet-ui-foundations`, `guest-kit` design-system rules, `guest-payment-choice` AC4, `manual-transfer-with-receipt` AC5). No failure touches the new rules. Log: `full-test-09.log`.
- Chat has no bank-transfer or manual-transfer surface (the server never emits `bankTransferArtifactToA2UI`), so the chat copy button has nothing to attach to; copy button covered on both pages. Parity (AC1) is therefore tested chat vs page for the pending payment; other screens exist only as pages and get structure tests.
- Card handoff keeps the existing Weaver label ("Continue to stay payment · ₦…") rather than "Pay ₦… by card" (changing it would alter the A2UI contract); "Choose another way to pay" added on the handoff state.
- New UI labels derived from existing copy: pills "Transfer not matched" / "Transfer account expired"; "Continue · ₦…" on the choice submit. "Amount due now" still includes the deposit while the next payment excludes it (issue 12 open).
- Choice submit for bank transfer uses a 307 to the existing `/transfer` POST.
- Capture: `capture-09.ts`, 31 images in `screenshots/09/`; reflow and 44px targets pass.

## Answer

Payment screens shipped in `dc306fb`, amount-label clarification in `c0db5d5`, and final desktop/dark-mode acceptance in `639e3cd`. The user accepted the page-based transfer flow: chat keeps the shared pending-payment screen; transfer details, copy buttons, receipt upload, waiting and recovery remain on conventional pages. AC1/AC4 above record that accepted scope; no transfer-specific chat UI is outstanding.

All seven DoD checks are documented above. Fresh verification: clean typecheck, 1253 non-browser + 165 Chromium passes, 1 existing opt-in skip and 0 failures. Existing captures in `screenshots/09/` and the user-approved issue-11 sweep remain the visual evidence; this close-out changes only tracker documentation. Historical uncommitted/formatting/issue-12-open notes above are superseded.
