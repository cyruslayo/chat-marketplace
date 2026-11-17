# Go straight to Paystack after the guest saves an email for card checkout

Status: resolved
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

### Owner decisions (17 Nov 2026)

1. One click (option a). After the email is saved, the chat shows the handoff whose continue control is `/payments/offers/<offerId>/continue`. The chat does not navigate on its own.
2. One message on both paths: "Hosted card checkout is ready. Payment has not succeeded; your booking details remain available when you return." The label and textFallback are the direct path's.

### Implementation (agent, 17 Nov 2026)

- `apps/local-guest/src/shortlet-app.ts`: one private helper `#cardCheckoutHandoff(thread, artifact, checkoutId)` builds the handoff for both `#handleCardCheckout` (email just saved, and the phone-then-email resume) and `#handlePaystackCardCheckout` (direct initialize-checkout). The helper owns the supersede, the active surface, the two transitions, the route, the label, the message (`CARD_CHECKOUT_READY_MESSAGE`), the textFallback and the A2UI card. The result carries no Paystack URL. The email path still resolves the existing checkout session; `/continue` initializes or reuses it (ADR 0087, 0046). No Paystack call is added to the email save.
- `conventionalCardPaymentRoute` callers, all left unchanged: `apps/local-guest/src/guest-server.ts:4082` (no-JS offer accept redirect, ADR 0080); `apps/local-guest/src/shortlet-app.ts` `#paymentSurface` (payment status surface); `apps/web-agent/src/presentation.ts:142` (status fallback); `apps/web/src/presentation.ts` (definition).
- Refundable Security Deposit: the same helper serves it (`currentComponent === "security_deposit"` branch), so the same rule applies: its handoff goes to `/continue` on both paths.
- Two deliberate changes to the old bodies:
  1. Amount fallback: the shared helper uses the email path's chain (`currentComponentAmountKobo`, then the deposit amount for `security_deposit`, then the stay total). The direct path used to fall back to the stay total for a deposit with no `currentComponentAmountKobo`. Only that edge case changes.
  2. The email path's textFallback no longer repeats the unit and dates ("Payment handoff ready for ..."); it now reads the direct path's text (decision 2).
- No client change (`apps/local-guest/src/client.ts` untouched), so `dist/client.js` was not regenerated. The guest-server routes and the standalone page are unchanged.

ADR table (read in full: 0087, 0044, 0046, 0074, 0077, 0080, 0093, 0106):

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0087 | Server issues the only `authorization_url`; browser never supplies the destination | `/continue` route; helper result has no URL; test 4 |
| 0044 | 20-minute Payment Window, no new deadline | Unchanged; no deadline code touched |
| 0046 | One Live Payment Attempt; `/continue` reuses it | Test 3 (same reference and checkout id across the email continue and a cold-restored continue) |
| 0074 | New handoff supersedes the email surface; stale surfaces fail closed | `#supersede(PAYMENT_STAGE)` in the helper; forged-surface guard unchanged |
| 0077 | One canonical artifact, same meaning on every path | Helper; test 2 |
| 0080 | Standalone page and no-JS POST route stay | Test 5; `guest-server.ts` untouched |
| 0093 | The email is a contact record and is not in the timeline | Test 6 |
| 0106 | Cold restore before every event; fail-closed resolution unchanged | Test file uses `coldApp` / `trueRestartedDatedApp`; `resolveCardPaymentServerEvent` untouched |

### Red run (before the change)

`env -u LLM_API_KEY npx tsx --test test/card-checkout-after-email.test.ts` run against the original `apps/local-guest/src/shortlet-app.ts` (HEAD copy put in place for the run, then the change restored and byte-compared): 6 tests, 4 pass, 2 fail.
- Test 1 failed: route `/payments/offers/<offerId>` (expected `.../continue`).
- Test 2 failed: message "Payment checkout is ready." (expected "Hosted card checkout is ready.").
- Tests 3 to 6 passed on the original code. They are guards for behaviour that already held (reuse of one attempt, no Paystack URL in the response, standalone page, email not in timeline).

### Assertions changed in existing tests

- `test/assistant-paystack-checkout-contact.test.ts:33`: the email-resumed card route asserted `^/payments/offers/[^/]+$` (the standalone page). It now asserts `.../continue$`, as decision 1 requires. This was the only failure in the first run of the payment set (71 tests, 70 pass, 1 fail); fixed and re-run green.
- `test/helpers/guest-payment-page.ts`: new optional `localPayment` (default `true`, so existing callers are unchanged), used by test 5.
- No other existing assertion changed. These match the kept wording ("payment has not succeeded") or do not check the email path, and pass unchanged: `test/assistant-cold-journey.test.ts:55`, `test/agent-mode-shell.test.ts:293`, `test/assistant-booking-journey.test.ts:76`, `test/guest-booking-journey.test.ts:104`, `test/local-guest-weaver-demo.test.ts:392`.

### Deviation from the criterion text

- AC5 says the standalone page "still shows Continue to hosted card checkout". The rendered page does not show that literal: its button reads "Continue to stay payment · ₦370,000" and its card choice reads "Hosted card checkout". The literal exists only as a label branch in `guest-server.ts` (around line 4302) that this page does not render. Test 5 is titled and asserts what the page does show: its own button, the no-JS `POST` form to the offer page, and the 303 from `method=card` to `/continue`. Page unchanged.

### Finding not fixed (owner decision needed)

- `#persistSession` (`domains/shortlet/src/card-payment.ts:271`) does not persist `checkoutUrl`, and the durable row type (`DurableCardCheckoutSession`, `domains/shortlet/src/guest-interaction-store.ts:1211`) has no URL field. A restored session therefore holds the placeholder `https://checkout.psp.example.com/pay/<ref>`, which `isApprovedPaystackCheckoutUrl` rejects, so every `/continue` after a cold restore calls Paystack `initialize` again with the same reference. The reference, the checkout session and the Payment Window do not change, so the one-attempt rule holds, but Paystack receives two initialize calls for one reference. The direct path has the same behaviour. Test 3 asserts that every initialize call carries the one session reference. A fix means the durable store keeps the approved URL (ADR 0046, 0087); not changed here.

### Commands and pass counts (agent, 17 Nov 2026)

- `env -u LLM_API_KEY npm run check`: exit 0 (tsc for root, cloudflare, cloudflare test and tooling; worker bundle guard).
- `env -u LLM_API_KEY npx tsx --test test/card-checkout-after-email.test.ts test/assistant-paystack-checkout-contact.test.ts test/assistant-cold-journey.test.ts test/timeline-email-masking.test.ts`: 24 tests, 24 pass.
- Payment route files: `env -u LLM_API_KEY npx tsx --test test/guest-must-fix-ux.test.ts test/guest-offer-payment-clarity.test.ts test/guest-payment-choice.test.ts test/guest-payment-consistency.test.ts test/manual-transfer-with-receipt.test.ts test/payment-callback-page.test.ts test/payment-continuation-diagnostic.test.ts test/pilot-production-composition.test.ts`: 47 tests, 47 pass.
- Wording and email-save files: `env -u LLM_API_KEY npx tsx --test test/assistant-paystack-checkout-contact.test.ts test/agent-mode-shell.test.ts test/assistant-booking-journey.test.ts test/guest-booking-journey.test.ts test/local-guest-weaver-demo.test.ts test/assistant-thread-lock.test.ts test/assistant-lane-read-path.test.ts test/conditional-offer-token-restore.test.ts test/extension-http.test.ts test/guest-account-page.test.ts test/guest-internal-terms.test.ts test/guest-surface-hooks.test.ts`: 137 tests, 137 pass.
- Real Chrome, solo: `env -u LLM_API_KEY npx tsx --test test/paystack-real-browser.test.ts`: 1 test, 1 pass (checkout.paystack.com was reachable; no DNS retry needed).
- Worker (`apps/local-guest/src/shortlet-app.ts` is in the Worker graph through `shortlet-pilot-do`): `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/demo-extended-stay.spec.ts apps/cloudflare/test/later-period-payments.spec.ts`: 2 files, 4 tests, 4 pass.
- Not run here: full `npm test` and full `npm run test:workers`. They run once per batch before merging to main, per the Test scope rule.

### Definition of Done (docs/agents/issue-tracker.md)

1. Each AC has a named test that mirrors the criterion text. Test 5's title differs from AC5 (see Deviation). Each test covers one AC.
2. Failure paths: AC4 asserts no Paystack URL and no provider call before `/continue`; AC3 asserts no second reference and no second checkout session; AC1 and AC2 are the success path with the old-route negative. AC6 asserts the email is absent from the handoff and the timeline.
3. ADRs listed and read (table above).
4. No new injected dependency. The helper takes the thread, the artifact and the checkout id; all are used.
5. No invented policy string: the message is the existing direct-path text, moved to one constant.
6. No credential or restricted material in logs or audit: the helper emits the existing transitions with the offer and checkout ids only, as before.
7. `npm run check`: zero errors. Full `npm test` is the batch gate, not run per issue.

### Follow-up after review (agent, 17 Nov 2026)

- AC5 deviation withdrawn. The literal "Continue to hosted card checkout" does appear on the standalone page once a checkout attempt exists (`checkout_initiated`, `apps/local-guest/src/guest-server.ts` around line 4302, `localPayment` false): the single link is `href="/payments/offers/<id>/continue"`. The earlier "Deviation" paragraph is superseded. Test 5 is titled as the criterion again and asserts the literal and its `/continue` href. The ready-offer method form and its no-JS 303 to `/continue` are asserted too, in the same test.
- Test 3 (AC3) no longer dedupes. It asserts the exact list of Paystack initialize references: `[ref, ref]` (the email-path continue, then the cold-restored continue). Reading `paystack.ts`: `reference_conflict` is raised only for a malformed reference or a response that returns a different reference. A repeated identical reference is not a conflict in our code. How Paystack itself answers a repeated reference is not verified offline; if it refuses one, `/continue` fails closed with `provider_rejected` and no second attempt is created.
- Amount fallback (outside the two owner decisions, listed as a deviation): the shared helper uses the email path's fallback, so a direct-path checkout with a deposit and no `currentComponentAmountKobo` now shows the deposit amount instead of the stay total. Only that edge case changes.
- Reach beyond the email path. `#handleCardCheckout` also serves every `initialize-checkout` event when Paystack is not wired (local demo mode, `shortlet-app.ts` case near line 1621). So the chat link changed in local mode too: it now runs `/continue`, which opens the local demo checkout (`/payments/local/checkout`) in one click. This is the owner's one-click decision applied to the local path; no separate local route was kept.
- Deliberate test change: `test/pilot-local.test.ts` (two local-payment journeys: the first around line 226, the AC26/AC27 journeys around line 388). They expected the chat link to open the standalone page, then click "Continue to local demo payment". With the change they wait for "Local demo payment" after the chat link (or the link that now targets `/continue`). Before the change `pilot-local` on the pre-change source passed 44 of 44 (run against HEAD source, then restored); on the change it failed 15 (first error: timeout waiting for "Continue to local demo payment"); after the test update it passes 44 of 44.
- Pre-existing environment failure, not caused by the change: `test/guest-request-handler.test.ts` test "ADR 0101: a handler composed with commerce locally creates the commerce tables and ledger rows" fails in a plain run (`COMMERCE_REFERENCE_HMAC_KEY ... must be set`). Solo with `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow` the file passes 9 of 9. Commerce composition, untouched by this issue.

### Wider coverage run (agent, 17 Nov 2026)

The grep for `conventionalRoute`, `fallback-link`, `payments/offers`, `/payments/local`, handoff wording, `initialize-checkout`, `card-payment`, the continue-label strings and the journey helper importers gave 140 files. Two are Worker specs, 15 are real-Chrome (both groups below).

- Node files, plain runs (`env -u LLM_API_KEY npx tsx --test <files>`, in 5 chunks; 123 files):
  - chunk 00: 334 tests, 334 pass.
  - chunk 01: 200 tests, 200 pass.
  - chunk 02: 135 tests, 134 pass, 1 fail (commerce key precondition above; passes solo with the test-only setting, 9 of 9).
  - chunk 03: 234 tests, 234 pass.
  - chunk 04: 30 tests, 30 pass.
- Real Chrome, one at a time, solo: `test/guest-offer-payment-clarity-chromium.test.ts` 1 of 1; `test/guest-real-browser-cross-tab.test.ts` 14 of 14; `test/mobile-guest-journey-chromium.test.ts` 43 of 43 (about 3 minutes); `test/guest-cross-tab-concurrency.test.ts` 18 of 18; `test/paystack-real-browser.test.ts` 1 of 1; `test/pilot-local.test.ts` 44 of 44 after the deliberate update (see above).
- Real-Chrome files with no payment-handoff reference were not run (confirmation, phone shell, sign-in offer, split workspace, unit detail, manual-transfer copy, weaver failure, criteria strip): the issue does not change those screens.
- Worker specs (`env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/demo-extended-stay.spec.ts apps/cloudflare/test/later-period-payments.spec.ts`): 2 files, 4 of 4 pass (from the earlier run; unchanged since).

### Commands re-run after the follow-up (agent, 17 Nov 2026)

- `env -u LLM_API_KEY npm run check`: exit 0.
- `env -u LLM_API_KEY npx tsx --test test/card-checkout-after-email.test.ts test/assistant-paystack-checkout-contact.test.ts test/assistant-cold-journey.test.ts test/timeline-email-masking.test.ts`: 24 tests, 24 pass.

Working-tree note: test runs rewrote generated screenshots under `.scratch/ui-recovery/recovered/*.png`; those were already modified before this issue's work and are not committed here.
