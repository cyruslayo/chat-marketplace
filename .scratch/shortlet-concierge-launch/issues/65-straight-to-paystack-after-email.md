# Go straight to Paystack after the guest saves an email for card checkout

Status: needs-triage
Type: task
Blocked by: none
Requested: 17 Nov 2026

## Why

Found on staging at b132a18 (17 Nov 2026, synthetic data, reservation `res_cmd-5e2f_1794916921901`). When the guest has no email on file, "Continue to stay payment" in the chat asks for an email first. After the guest saves it, they are not taken to checkout. They must:

1. click "Continue to stay payment · ₦390,000" in the chat, which is a link to the standalone payment page `/payments/offers/<offerId>`; then
2. click "Continue to hosted card checkout" on that page, which goes to `/payments/offers/<offerId>/continue` and redirects to `checkout.paystack.com`.

A guest who already has an email on file gets a single click: the same chat control links to `/continue` directly. So the email step adds two clicks and a page change in the Payment Window (20 minutes, ADR 0044).

Facts from the survey:

- Direct path (email on file): the `shortlet.card-payment.initialize-checkout` event returns the handoff surface with `conventionalRoute: /payments/offers/<offerId>/continue` (`apps/local-guest/src/shortlet-app.ts`, around line 1415).
- Email-just-saved path: `#handleCardCheckout` (around line 6143, reached after the email contact surface is saved) returns `conventionalRoute: conventionalCardPaymentRoute(thread.offerId)`, the standalone payment page (around line 6228). Its message also differs: "Payment checkout is ready." against "Hosted card checkout is ready."
- The chat renders `conventionalRoute` as a plain `a.fallback-link` (`apps/local-guest/src/client.ts`, around line 2238). After the email is saved, the payment card's only button is "Check payment status" (`apps/web-agent/src/card-payment-a2ui.ts:31`, `verify_return` action).
- The `/continue` route already initializes or reuses the Live Payment Attempt on the server and redirects to the validated Paystack `authorization_url` (ADR 0087). The browser never supplies the destination.

## What to build

Make the email-just-saved path match the direct path, so the guest reaches Paystack with one click after saving the email.

1. After the email is saved for a card checkout, the handoff surface's continue control goes to `/payments/offers/<offerId>/continue`, the same as the direct path, with the same label and message.
2. Owner decision 1 decides whether that one click is still required, or whether the chat navigates on its own once the email is saved.
3. The standalone payment page and its "Continue to hosted card checkout" link stay as they are; the no-JS path is unchanged (ADR 0080).
4. No new redirect destination. The server still issues the only Paystack URL, through `/continue` (ADR 0087). The client never builds or receives a Paystack URL.

## Open owner decisions

1. **One click or automatic.** (a) After the email is saved, the chat shows the handoff with the continue control pointing at `/continue`: one click to Paystack. (b) The chat navigates to `/continue` on its own once the email is saved. Recommendation: (a). The guest sees the amount and the "you will leave Shortlet" text before leaving (guideline §10, money and state), and the page does not change under them without a gesture.
2. **Message.** Use the direct path's message ("Hosted card checkout is ready. …") on both paths. Recommendation: yes, one message.

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0087 | The server initializes Paystack and issues the only `authorization_url`; the browser never supplies the destination. | Step 4; AC 4. |
| 0044 | The Payment Window is 20 minutes after Accept Offer. | Why; AC 1. |
| 0046 | A superseded or reminted reference is ignored on late success. The `/continue` route must reuse the Live Payment Attempt, not mint a second one. | AC 3. |
| 0080 | No-JS parity: the standalone page and its link stay. | Step 3; AC 5. |
| 0074 | Generative surfaces have a fail-closed lifecycle: the new handoff surface supersedes the email surface, and a stale one fails closed. | Step 1; AC 1. |
| 0077 | One canonical artifact rendered across channels; the chat and the page say the same thing. | Steps 1 and 2; AC 2. |
| 0093 | The email is a contact record and never appears in the timeline (03n). | AC 6. |

## Acceptance criteria

Each is its own `test()` in `test/card-checkout-after-email.test.ts` (new). Assistant runtime enabled, cold restore before every event, clock 2026-10-27, staging-like guest with no seeded phone or email (AGENTS.md, Concierge assistant path).

1. After the guest saves an email for card checkout, the handoff surface's continue control is `/payments/offers/<offerId>/continue`, the same as for a guest with an email on file.
2. The handoff message and label are the same on both paths.
3. Following that control after the email save, and then following the direct path's control, reuses one Live Payment Attempt (no second checkout session).
4. The response carries no Paystack URL; the redirect comes only from `/continue` on the server.
5. The standalone page `/payments/offers/<offerId>` still shows "Continue to hosted card checkout" (no-JS path unchanged).
6. The saved email does not appear in the timeline or the handoff text.

## Verification

- `env -u LLM_API_KEY npm run check`.
- `env -u LLM_API_KEY npx tsx --test test/card-checkout-after-email.test.ts test/assistant-paystack-checkout-contact.test.ts test/assistant-cold-journey.test.ts test/timeline-email-masking.test.ts` plus the Paystack handoff and guest-server payment-route tests the change touches.
- Real Chrome, solo: `test/paystack-real-browser.test.ts` (it needs network access to `checkout.paystack.com`).
- Live: on staging, in daytime Lagos hours, save an email in the chat and confirm one click reaches `checkout.paystack.com`. Stop before card entry.
- Record the exact commands and pass counts under `## Comments`.

## Out of scope

- Bank transfer and manual transfer paths (ADR 0088).
- The Refundable Security Deposit checkout, unless it shares the same code path (then the same rule applies; say so in Comments).
- Changing the Payment Window or the Paystack adapter.

## Comments
