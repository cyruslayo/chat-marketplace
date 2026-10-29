# Checkout fixes evidence (28 Oct 2026)

Worktree: `C:\AI2026\chat-marketplace-fixes`, branch `fix/staging-checkout-journey`, cut from `26bafd5`.
Investigation: `.scratch/concierge-agent-controls/validation/2026-10-28/checkout-defects-investigation.md`.
Offline only: no push, deploy, Cloudflare command, live or paid call, or browser test. `env -u LLM_API_KEY` on every command. No environment was printed.

## Scope of this evidence

| Task | Status | Commit |
|---|---|---|
| B: Paystack card start contact pre-check (email, then phone) | Fixed, tests red then green | `dd6fc28` |
| C: Confirmation token salt persisted across runtime rebuilds | Stopped. No code change (see the report) | none |
| A: Generic "Payment can't continue right now" diagnostics | Proposal only, not implemented | none |

## Task B: red, then green

Test file: `test/assistant-paystack-checkout-contact.test.ts`. Setup: the Paystack payments module wired through `datedFixture(..., { paystackClient })`, the assistant runtime enabled, a cold restore (`restartedDatedApp` over the same store) before every event, a staging-like guest (no phone, no email), clock 27 Oct 2026, and the clock advanced in place for the expired-window case.

Command (both runs):

    env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/assistant-paystack-checkout-contact.test.ts

Red, before the fix in `apps/local-guest/src/shortlet-app.ts`:

- `pass 4, fail 3`
- Failing (the defect): email prompt (`ACTION_NOT_AUTHORIZED` instead of `:contact:email:`), email save then resume, phone prompt.
- Passing before the fix (guards that must stay fail-closed): forged payment surface gives `STALE_SURFACE`; an offer no longer accepted gets no contact prompt and `ACTION_NOT_AUTHORIZED`; an expired window gets no contact prompt and a closed rejection; a Paystack start failure gives a closed `ACTION_NOT_AUTHORIZED` with "could not be started".
- Two earlier red runs were test-authoring errors (an expired-window code expectation, and a start-failure test with no saved email), corrected before the fix. They are not counted above.

Green, after the fix:

- `pass 7, fail 0`

Fix commit `dd6fc28`: `#paymentContactPrompt` (phone first, then email, gated on accepted status, the window and the payer's `initialize_checkout` action), the `resumeAction: "payment"` branch in the phone-save handler, and a defensive phone mapping in the start catch.

## Type check

    env -u LLM_API_KEY npm run check

- Exit 0. Includes `tsc --noEmit` for the root, `apps/cloudflare`, its test and tooling configs, and `scripts/check-worker-bundle.mjs`.
- One earlier run failed on a helper type (`ConstructorParameters` on a static method). It was fixed in `test/helpers/guest-date-fixtures.ts` before the commit.

## Affected non-browser tests

Run 1 (payments, assistant and conditional-offer files):

    env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/assistant-paystack-checkout-contact.test.ts test/assistant-cold-journey.test.ts test/assistant-booking-journey.test.ts test/guest-booking-journey.test.ts test/guest-payment-choice.test.ts test/guest-payment-consistency.test.ts test/integrate-card-payment-application.test.ts test/integrate-conditional-offer-application.test.ts test/integrate-security-deposit-payment.test.ts test/issue-and-accept-conditional-booking-offer.test.ts test/paystack-pilot.test.ts test/paystack-transfer-adapter.test.ts test/platform-payments.test.ts test/later-period-payment-routes.test.ts test/phase4-booking-payment-presentation.test.ts test/render-card-payment-weaver-a2ui.test.ts test/render-conditional-offer-weaver-a2ui.test.ts

- `tests 125, pass 125, fail 0`

Run 2 (guest, assistant and pilot files that load the chat app):

    env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/guest-must-fix-ux.test.ts test/guest-contact-pilot.test.ts test/guest-never-silent.test.ts test/guest-process-restart.test.ts test/guest-offer-access.test.ts test/guest-sign-in-offer.test.ts test/guest-request-handler.test.ts test/guest-new-conversation.test.ts test/guest-transition-telemetry.test.ts test/guest-real-dates.test.ts test/guest-chip-continuity.test.ts test/assistant-artifact-authority.test.ts test/assistant-persistent-continuity.test.ts test/assistant-date-literal-authority.test.ts test/assistant-scope-persistence.test.ts test/pilot-local.test.ts test/pilot-guardrails.test.ts test/pilot-production-composition.test.ts test/guest-cross-tab-concurrency.test.ts test/guest-draft-revision.test.ts test/guest-identity-assurance.test.ts

- `tests 316, pass 314, fail 2`
- Failure 1: `guest-cross-tab-concurrency.test.ts` AC12, `fetch failed` on a local socket. Re-run alone: `tests 18, pass 18, fail 0`.
- Failure 2: `pilot-local.test.ts` AC4, `spawnSync ... ETIMEDOUT` in a child Node process under load. Re-run alone: `tests 44, pass 44, fail 0`.
- Both are load flakes in this run, not regressions from the change.

## Not run, and why

- Real-browser and Chromium suites (`*.real-browser.test.ts`, `*-chromium.test.ts`): excluded by the offline-only instruction.
- `npm run test:workers`: no Worker source file changed (`apps/cloudflare/src` untouched). The bundle is rebuilt from the same source.
- Full `npm test`: the pre-merge gate, run once per batch, not per issue.
- The remaining ~90 non-browser files that import the chat app, outside the two runs above.

## Build and descriptor

Recorded in the final report, after this commit.

## Defect C: Conditional Offer token restore (Option 2)

Owner decision: persist only a SHA-256 digest of each issued confirmation token. Commit `e002496`.

### ADR constraints and how the design meets them

| ADR | Constraint | Where it is met |
|---|---|---|
| 0075 | The confirmation token never enters the durable store; restricted material stays out of logs and projections. | `#persistOffer` still strips `confirmationToken`. The row holds only `confirmationTokenDigests`. Tests: "the token and its salt never reach the database or diagnostics". |
| 0086 | Restricted material is stored only as a secure hash; the presented value is compared, not looked up. | `confirmationTokenDigest` (SHA-256). `matchesConfirmationTokenDigest` compares with `timingSafeEqual` over all digests. |
| 0072 | A consequential action goes through the platform command with a server-issued confirmation token, with server-side authorization, concurrency and idempotency. | `acceptOffer` keeps the role, tenant, actor, status, `expectedVersion`, expiry and `tokenUsed` checks. Accepting clears every digest, so a replay fails. |
| 0106 | The platform gate stays authoritative and fails closed; models never grant authority. | The `isAuthorized` gate still rejects. A missing or empty digest set returns false. The model is not involved in accept. |
| 0070, 0093 | Identity and principal are unchanged. | No change to the principal checks. Existing forged-principal tests stay green. |

### Design

- Persisted: `offer_json.confirmationTokenDigests`, an array of hex SHA-256 digests, newest last, at most `CONFIRMATION_TOKEN_DIGEST_LIMIT = 16`. No schema or column change. No token, salt or key is stored.
- Salt: 128 bits from `crypto.randomBytes(16)` (was `randomUUID`, 122 bits). The token is unguessable, so an unsalted SHA-256 digest is acceptable and no new secret is introduced.
- Issue: the token is minted and its digest recorded.
- Restore (`getOffer` hydrate, for an issued and unused offer): a fresh token is minted in memory, its digest is appended and pruned to the newest 16, and the offer is persisted. The browser's earlier token keeps its digest, so it still validates. Accepted or used offers get no new token.
- Gate: the accept action carries the current token (unchanged) and `confirmationTokenDigests`. `isAuthorized` accepts when the digest of the presented token is in that list. Missing digests fail closed.
- Accept: status, expiry and `tokenUsed` checks run first. The presented token must decode, its claims must match, and its digest must be one of the offer's digests. On success the offer is accepted, `tokenUsed` is set, and every digest and the in-memory plaintext are cleared (single use).
- Validity: a digest is valid only while the offer is `issued`, unused and before `paymentWindow.expiresAt`, and only for that offer (the digest is over the offer's own token, whose claims include `offerId`).
- The HMAC literal `conditional_offer_secret` remains in `createConfirmationToken` and `decodeConfirmationToken`. It is not dead, because decode still verifies it, so it is left in place. Security no longer depends on it, since acceptance requires the exact digest of an issued token. Moving the key to a configured secret remains a separate issue.
- Legacy rows (persisted before this change) have no digests. Their pre-deploy tokens fail closed. The guest gets a fresh token on the next render. This is a one-time effect at deploy.

### Red, then green

Red (new file against the pre-fix code, `test/conditional-offer-token-restore.test.ts`):

    env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/conditional-offer-token-restore.test.ts

- `tests 8, pass 3, fail 5`. The failures were the held token after a true restart (`ACTION_NOT_AUTHORIZED`), the cross-environment accept, single-use replay, the digest persistence check, and the bounded-digest check. The three that already passed are the guards: forged, other-offer and expired tokens.

Green, first run after the fix, with the existing offer files:

    env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/conditional-offer-token-restore.test.ts test/issue-and-accept-conditional-booking-offer.test.ts test/integrate-conditional-offer-application.test.ts test/render-conditional-offer-weaver-a2ui.test.ts

- `tests 17, pass 17, fail 0`.

Type check, after making the two digest fields optional so existing literal fixtures still compile (missing digests fail closed):

    env -u LLM_API_KEY npm run check

- Exit 0.

Affected non-browser set, first run:

- `tests 218, pass 217, fail 1`. The one failure was `guest-process-restart.test.ts` "Token test 3", which asserted that a pre-restart token is refused on the unchanged restored offer. That is the behaviour the owner decision reverses. The test is rewritten to assert that the token authorizes the unchanged offer, and fails closed after the offer changes (past the payment window, using the fixture clock). This is the only edit to an existing test.
- `test/guest-process-restart.test.ts` after the rewrite: `tests 23, pass 23, fail 0`.

Affected non-browser set, final run:

    env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/conditional-offer-token-restore.test.ts test/issue-and-accept-conditional-booking-offer.test.ts test/integrate-conditional-offer-application.test.ts test/render-conditional-offer-weaver-a2ui.test.ts test/guest-offer-access.test.ts test/guest-offer-consistency.test.ts test/guest-sign-in-offer.test.ts test/guest-payment-choice.test.ts test/guest-payment-consistency.test.ts test/guest-process-restart.test.ts test/guest-restart-helper.test.ts test/integrate-card-payment-application.test.ts test/integrate-bank-transfer-application.test.ts test/integrate-security-deposit-payment.test.ts test/integrate-security-deposit-bank-payment.test.ts test/manual-transfer-with-receipt.test.ts test/provider-issued-transfer-account.test.ts test/expire-transfer-and-refund-late-payment.test.ts test/phase4-booking-payment-presentation.test.ts test/pay-by-card-and-form-one-booking-contract.test.ts test/paystack-pilot.test.ts test/demo-auto-accept.test.ts test/demo-accept-delay-config.test.ts test/assistant-cold-journey.test.ts test/assistant-booking-journey.test.ts test/assistant-paystack-checkout-contact.test.ts test/guest-booking-journey.test.ts test/operator-process-restart.test.ts test/capability-gate-ussd-and-authentication.test.ts test/render-card-payment-weaver-a2ui.test.ts test/render-bank-transfer-weaver-a2ui.test.ts

- `tests 218, pass 218, fail 0`.

Worker spec (the domain offer code is bundled into the Worker):

    env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/demo-extended-stay.spec.ts

- `Test Files 1 passed (1); Tests 2 passed (2)`.

Not run: the real-browser and Chromium files (offline-only instruction), and the full `npm test` and `npm run test:workers` (pre-merge, once per batch).

---

## Payment link after "checkout ready" (fix/staging-checkout-journey, HEAD 335dfb5)

Scope: offline only. No live network, no Cloudflare/wrangler, no push, deploy or merge. Synthetic data. Full `npm test` and `npm run test:workers` were not run (per-issue scope).

### Reported symptom

Offer accepted, email saved in chat, chat reported "Payment checkout is ready", and `/payments/offers/<id>/continue` showed "Payment can't continue right now" (PAYMENT_CONTINUATION_REJECTED).

### What the code does (traced offline)

1. The contact-save resume (email save, and phone save with `resumeAction: "payment"`) calls `#handleCardCheckout`, the deterministic path. It creates the session through `initializeCheckout` with no provider call. The chat surface links to `/continue`.
2. `/continue` calls `initializePaystackCheckout`. That is the first Paystack `transaction/initialize` for the reference. Its failure is caught by one silent catch.
3. `persistSession` does not store `checkoutUrl` (ADR 0075 as coded). A cold restore hydrates a placeholder URL that `isApprovedPaystackCheckoutUrl` rejects, so a later start re-initializes the same reference.

### Hypotheses

| # | Hypothesis | Result |
|---|---|---|
| 1 | Chat started Paystack, then `/continue` starts a second attempt for the same reference | Eliminated for the current code: the chat resume makes 0 provider calls (commit 1221dab asserts this before `/continue`). The mechanism is real only if the chat ever starts Paystack (Finding B). |
| 2 | Cold restore loses checkout state | Partly confirmed: the hosted URL is not durable. In-process, a restored resume returns an approved URL with one provider call. Not enough on its own to explain the live failure. |
| 3 | Paystack start fails for a reason a closed code reveals | Not reproduced offline (fake returns success). Closed reason now recorded (commit ea08b85). Live cause unknown. |
| 4 | `cardPaymentArtifactFromState` shows non-accepted offers as ready | Real defect, fixed (bceb75e). Not the owner's case, which had an accepted offer. |
| 5 | No phone pre-check on the deterministic checkout | Real defect, fixed (98fc9ac). |

The offline reproduction does not reproduce the live failure. The continuation succeeds in-process with the fake Paystack client.

### Commits

| Commit | Change | Test |
|---|---|---|
| 1221dab | Characterization: resume after a true cold restore gives an approved URL with exactly one provider initialization for the session's reference. Passes at HEAD (no fix needed). | `resuming the payment link after a true cold restore returns the approved hosted checkout with one Paystack initialization` |
| 98fc9ac | Phone asked before email on `#handleCardCheckout` | `Start checkout without a Paystack module asks for the phone number before the email, as the Paystack path does`. Failed before the fix (`...:contact:email:...`). |
| bceb75e | Artifact payable only when the offer is accepted: issued/stale/revoked -> `failed`; expired -> `expired`; accepted -> `ready` | `A payment artifact for an offer that is not accepted is never shown as ready to pay`. Failed before the fix (`a issued offer is not payable`). The revoked-offer contact test now also accepts the closed `STALE_ACTION`. |
| ea08b85 | Optional `onPaymentContinuationRejected` observer with closed reasons (`offer_not_accepted`, `contact_missing`, `payment_window_closed`, `provider_start_failed`, `unclassified`). No ids, URLs, references or provider text. The guest page is unchanged. | `A rejected payment continuation reports a closed reason and no identifiers or provider text`. Written after the change, so not observed failing first. |

### Counts (after the four commits)

Each file run as `env -u LLM_API_KEY npx tsx --test <file>`:

| File | Result |
|---|---|
| test/assistant-paystack-checkout-contact.test.ts | 9 pass, 0 fail |
| test/assistant-cold-journey.test.ts | 3 pass, 0 fail |
| test/guest-must-fix-ux.test.ts | 7 pass, 0 fail |
| test/phase4-booking-payment-presentation.test.ts | 17 pass, 0 fail |
| test/paystack-pilot.test.ts | 45 pass, 0 fail |
| test/render-card-payment-weaver-a2ui.test.ts | 1 pass, 0 fail |
| test/guest-payment-choice.test.ts | 4 pass, 0 fail |
| test/guest-payment-consistency.test.ts | 5 pass, 0 fail |
| test/payment-continuation-diagnostic.test.ts | 1 pass, 0 fail |

`env -u LLM_API_KEY npm run check` (tsc, apps/cloudflare, tooling, worker bundle guard): exit 0.

### Findings and decisions for the owner

- **A. Live cause still open.** Once a build passes `onPaymentContinuationRejected` to the host and staging logs the reason: `provider_start_failed` means Paystack rejected the initialize call (check that reference in the Paystack dashboard, no secrets printed); `contact_missing`, `offer_not_accepted` or `payment_window_closed` mean domain state at click time; `unclassified` means extend the enum. The Cloudflare host does not pass the observer yet. Wiring it is a host change to approve before deploy.
- **B. Decision needed.** The contact-save resume creates the checkout without a Paystack start even when Paystack is configured, so chat says "ready" before the provider sees the payment. Routing the resume through `#handlePaystackCardCheckout` moves the first provider call into chat and changes when the live attempt starts (ADR 0046). Not implemented.
- **C. Decision needed.** The hosted checkout URL is not persisted (ADR 0075 as coded), so any restore-then-start re-initializes the same reference. Options: persist the authorization URL (policy change under ADR 0075), or mint a new reference and supersede the old attempt (ADR 0046/0049). Unverified: whether Paystack rejects a reused reference. Not assumed either way.
- **D. Mapping choice.** Non-accepted offers map to the existing `failed` status ("Payment was not verified. No Reservation was created."). No new status invented. Owner to confirm the copy.

### Not verified

- Live Paystack behaviour for a reused reference (C).
- Live cause of the reported PAYMENT_CONTINUATION_REJECTED (A).
- Browser and staging screens (no staging calls in this task).
- Full `npm test` and `npm run test:workers` (once per batch before merge).
