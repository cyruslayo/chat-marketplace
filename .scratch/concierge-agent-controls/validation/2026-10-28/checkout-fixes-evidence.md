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

### Continuation rejection log wiring (finding A closed in code)

The Cloudflare host now passes `onPaymentContinuationRejected` to the guest handler (`apps/cloudflare/src/shortlet-pilot-do.ts`). A rejected continuation writes one Workers Logs line through `logPaymentContinuationRejected` (`apps/cloudflare/src/payment-continuation-log.ts`): `{"event":"payment_continuation_rejected","reason":"<closed reason>"}`. The line carries no offer id, URL, reference, contact, cookie, secret or provider text.

Tests were written first and failed on the missing module (`Cannot find module '../src/payment-continuation-log.js'`). A worker spec through `SELF.fetch` was tried first and dropped: an unknown offer returns 404 before the continuation's try block, so that path cannot produce a rejection without a full accepted-offer Paystack journey. The spec exercises the observer directly, so the one-line wiring in the Durable Object is verified by typecheck and review, not by a live rejection.

| Command | Result |
|---|---|
| `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/payment-continuation-log.spec.ts` (before implementation) | fail: `Cannot find module '../src/payment-continuation-log.js'`, no tests run |
| `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/payment-continuation-log.spec.ts` (after) | 3 pass, 0 fail |
| `env -u LLM_API_KEY npm run check` | exit 0 (tsc root, apps/cloudflare, tsconfig.test, tsconfig.tooling, worker bundle guard) |
| `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/pilot-worker.spec.ts apps/cloudflare/test/edge-security.spec.ts apps/cloudflare/test/payment-continuation-log.spec.ts` | 3 files, 9 pass, 0 fail |

The worker runner resolved `node_modules` through `../chat-marketplace/node_modules` (the main worktree). This is the existing setup, not changed here.

## Task: chat card start diagnostics (29 Oct 2026)

Branch `fix/staging-checkout-journey`, worktree `C:\AI2026\chat-marketplace-fixes`. Offline only: no live or paid call, no Cloudflare, wrangler or cf command, no push, merge or deploy. `env -u LLM_API_KEY` on every command. No environment was printed.

### Where the live message comes from

`"The secure card checkout could not be started."` (code `ACTION_NOT_AUTHORIZED`) is produced only by the `catch` at the end of `#handlePaystackCardCheckout` in `apps/local-guest/src/shortlet-app.ts`. Everything after the contact pre-check and the gate sits inside that `try`: `initializePaystackCheckout` (domain checks, session creation, the Paystack initialize call, the approved-URL and reference checks, `updateCheckoutUrl`), then `getArtifact`, `#supersede`, `#emitTransition` and the A2UI build. Before this change the catch wrote nothing to the host, which is why Workers Logs showed no line. Gate rejections return their own codes and messages, so they cannot produce this text.

### ADR table (AGENTS.md, implementation protocol)

| ADR | Constraint | Where it is met |
|---|---|---|
| 0075 | No ids, URLs, references, contacts, keys or provider text in logs or errors | Closed reason enum; `PaystackProviderFailure` messages are fixed strings; `card-checkout-log.ts` writes only `event` and `reason` |
| 0046 | One live attempt; replacements need unique references; no reset of the window | The observer changes no state. The guest result is unchanged. No reference format changed |
| 0049 | Fresh PSP-hosted checkout only at an approved hosted URL | `checkout_url_rejected` keeps the existing approved-host check (`checkout.paystack.com`) |
| 0106 | Gate and server-owned authority stay fail closed | Gate, contact pre-check and guards are untouched; gate rejections are reported as `action_rejected` only |

### Commits

| Commit | Scope |
|---|---|
| `bd4f87c` | Tests first: `test/card-checkout-failure-diagnostic.test.ts`, `apps/cloudflare/test/card-checkout-log.spec.ts` (red until the following commits) |
| `eb00783` | `packages/platform-core/src/payments/paystack.ts`: typed `PaystackProviderFailure`; `test/paystack-pilot.test.ts` expectation moved to the new fixed message |
| `e019a2d` | `apps/local-guest/src/shortlet-app.ts` observer and classifier; `apps/local-guest/src/guest-server.ts` option wiring |
| `0c40693` | `apps/cloudflare/src/card-checkout-log.ts` helper; `apps/cloudflare/src/shortlet-pilot-do.ts` wiring |

### Failure branches and their closed reasons

| Branch (where it fires) | Paystack call made? | Reason |
|---|---|---|
| Initialize returns non-2xx or `status: false` (`assertProviderResponse`) | Yes | `provider_rejected` |
| Request cannot be sent (fetch throws) | Attempted | `provider_unreachable` |
| Response body is not JSON | Yes | `provider_response_invalid` |
| Returned reference differs from the one sent | Yes | `reference_conflict` |
| Returned `authorization_url` not on the approved host | Yes | `checkout_url_rejected` |
| Gate rejection, stale surface, unknown thread (no Paystack call) | No | `action_rejected` |
| Payment window closed (rejected by the gate, no Paystack call) | No | `action_rejected` |
| Domain messages: accepted-offer, window, eligibility, deposit (`initializeCardCheckout`) | No | `offer_not_payable` (classifier) |
| Domain messages: authoritative payer, cross-tenant | No | `payer_not_authorized` (classifier) |
| `Paystack checkout is not configured` (apps/web, only without a provider override) | No | `provider_not_configured` (classifier only; the chat always passes its provider) |
| Non-card checkout returned by `payments.start` | Yes | `provider_response_invalid` (classifier) |
| Anything else, including persistence errors | Unknown | `unclassified` |

Not reported: the phone and email prompts (`:contact:` surfaces are normal results, `ok: true`). `persistence_failed` was not added because a store error has no reliable message to match and is not wrapped; such errors are `unclassified`.

### Offline findings

- Config: `loadPaystackConfiguration` runs when the Durable Object is built (`loadPilotCoreConfiguration`). An empty `PAYSTACK_SECRET_KEY` on the Worker fails there with `PAYSTACK_SECRET_KEY is required`, which would stop the Durable Object, not produce this chat message. The config-empty hypothesis does not explain the live text.
- No offline bug reproduces the live message on the success path. The fake Paystack success path reaches the resumed payment card, the approved-URL check accepts the `checkout.paystack.com` shape, and no `await` is missing on this path.
- Candidate for the live cause (not verified, and not changed): the Paystack reference is built as `psp_ref_<8 chars of command id>_<ms>` in `domains/shortlet/src/card-payment.ts` (`initializeCardCheckout`). It contains underscores. From memory of Paystack's documentation, which could not be checked here without a live call, Paystack accepts only letters, digits, `-`, `.` and `=` in a transaction reference. If Paystack rejects it, Initialize fails with no transaction, which matches the empty Paystack dashboard and the silent logs. The new log line tells the owner the category: a `provider_rejected` on staging points to Paystack's side. Changing reference format touches ADR 0046 and 0049 references and needs an owner decision.
- Retry behaviour: a failed first start leaves the session `initiated` with the placeholder checkout URL (`https://checkout.psp.example.com/...`), and the next click reuses the same reference (`apps/web/src/card-payment-application.ts`, `initializePaystackCheckout`). One rejected reference therefore fails every retry. Noted, not changed.

### Commands and counts

Red (before the implementation):

    env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/card-checkout-failure-diagnostic.test.ts

- The module failed to load, because `PaystackProviderFailure` and the observer did not exist: `tests 1, fail 1`.

Green (after `eb00783` and `e019a2d`):

    env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/card-checkout-failure-diagnostic.test.ts

- First run: `tests 9, pass 8, fail 1`. The failing case expected a no-module chat start to fail. It succeeds on the deterministic local PSP, so the observer call for it was removed and the case now asserts the local path reports nothing.
- After that change: `tests 9, pass 9, fail 0`.

Worker spec:

    env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/card-checkout-log.spec.ts

- The bundle guard passed, and vitest ran only the spec: `Test Files 1 passed (1)`, `Tests 3 passed (3)`. The spec was written before its helper but not run separately red.

Type check:

    env -u LLM_API_KEY npm run check

- Exit 0. Covers root, `apps/cloudflare`, `tsconfig.test.json`, `tsconfig.tooling.json` and the worker bundle guard.

Affected non-browser files:

    env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/card-checkout-failure-diagnostic.test.ts test/payment-continuation-diagnostic.test.ts test/assistant-paystack-checkout-contact.test.ts test/paystack-pilot.test.ts test/platform-payments.test.ts test/paystack-transfer-adapter.test.ts test/integrate-card-payment-application.test.ts test/guest-payment-choice.test.ts test/guest-payment-consistency.test.ts test/pilot-production-composition.test.ts test/assistant-cold-journey.test.ts

- First run: `tests 98, pass 97, fail 1`. The failure was `paystack-pilot` AC14, which asserted the old message `/invalid checkout/`. Its expectation now matches `/unapproved checkout URL/`, the same rejection.
- After that change: `tests 98, pass 98, fail 0`.

Related restart and pilot files:

    env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/guest-browser-restart.test.ts test/guest-never-silent.test.ts test/pilot-local.test.ts test/guest-process-restart.test.ts test/assistant-booking-journey.test.ts

- `tests 82, pass 81, fail 1`. The failure was `pilot-local` AC4 ("Production pilot:start still fails without required Paystack credentials"), which spawns a child process. The same flake was recorded above.
- `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/pilot-local.test.ts` run alone: `tests 44, pass 44, fail 0`.

Not run: real-browser and Chromium suites; full `npm test` and the batch `npm run test:workers` (pre-merge, once per batch); the workerd local load of the bundle (needs wrangler, which the owner runs).

### Staging bundle

Command, from `apps/cloudflare`, with the exact environment given in the task:

    env -u LLM_API_KEY -u COMMERCE_ENABLED -u RESEND_API_KEY -u GEMINI_API_KEY SHORTLET_DEMO=enabled CONCIERGE_MODE=openai-compatible LLM_BASE_URL=https://openrouter.ai/api/v1 LLM_MODEL=openai/gpt-6-luna LLM_PROVIDER_LABEL=openrouter CONCIERGE_DAILY_MODEL_CALL_CAP=1500 CF_ACCESS_TEAM_DOMAIN=lucky-silence-5605.cloudflareaccess.com CF_ACCESS_AUD=<aud> node ../../node_modules/@cloudflare/vite-plugin/bin/cf-vite build --mode staging

- Exit 0. The bundle `.cloudflare/output/v0/workers/default/bundle/index.js` contains `card_checkout_failed`, `provider_unreachable` and `PaystackProviderFailure`.

Descriptor `apps/cloudflare/.cloudflare/output/v0/workers/default/worker.config.json`, checked by key name and type; values printed only for non-secret fields:

- Name `shortlet-pilot-staging`: PASS.
- `COMMERCE_ENABLED` is the text `false`: PASS.
- `SHORTLET_DEPLOYMENT` `staging`, `PAYSTACK_ENVIRONMENT` `test`, `SHORTLET_DEMO` `enabled`: PASS.
- `CONCIERGE_DAILY_MODEL_CALL_CAP` `1500`: PASS.
- Origin `https://shortlet-pilot-staging.khayutsefi.workers.dev` (workers.dev); `PAYSTACK_CALLBACK_BASE_URL` equals it: PASS.
- `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` present and equal to the given values: PASS.
- `LLM_BASE_URL`, `LLM_MODEL`, `LLM_PROVIDER_LABEL` equal the given values: PASS.
- `RESEND_API_KEY` and `GEMINI_API_KEY` absent: PASS.
- Secret-typed bindings are exactly `PAYSTACK_SECRET_KEY`, `LLM_API_KEY`, `SHORTLET_GUEST_CODE_HASHING_KEY`, `OPS_SHARED_SECRET`: PASS. `PAYSTACK_SECRET_KEY` is secret-typed: PASS.

Unverified: the live staging behaviour (no live call allowed); the workerd local load of the bundle; the Paystack reference-format hypothesis; the owner's deploy, which has not happened.


## Chat card checkout: Paystack reference format (commit d6724a4)

Worktree `C:\AI2026\chat-marketplace-fixes`, branch `fix/staging-checkout-journey`, base `fd668c7`. The `apps/local-guest/dist/*.js` and `apps/cloudflare/public/_headers` changes that were already in the worktree were not staged or committed.

### Root cause (hypothesis from the task; the fix is in code, the live provider response is not in this repository)

`domains/shortlet/src/card-payment.ts` minted `psp_ref_<commandId 8 chars>_<ms>`. Paystack accepts only letters, digits, `-`, `.` and `=` in a transaction reference, so the initialize for that reference is refused. `apps/web/src/card-payment-application.ts` `initializePaystackCheckout` reused the stuck `initiated` session on every retry, so the same bad reference failed every retry for the offer.

### Every reference site found

Created:
- `domains/shortlet/src/card-payment.ts` `initializeCardCheckout`: stay and deposit attempt reference. Now `mintCardPspReference`, giving `psp-ref-<8 letters/digits>-<ms>`.
- `domains/shortlet/src/period-payment.ts` (~line 273): later Billing Period reference, now `psp-ref-period-<index>-<token>`.
- `domains/shortlet/src/bank-transfer.ts` (~line 476): Pay with Transfer reference `exp_trf_<12 hex>`, sent to Paystack as the Charge API `reference` in `PaystackBankTransferClient.createTransferAccount`. It still has an underscore and is NOT changed here (open issue 1).
- `domains/shortlet/src/bank-transfer.ts` (~line 1295) `ref_<hex>` and `packages/platform-core/src/reconciliation.ts` `ref-...`: internal refund ids, never sent to Paystack.
- `domains/commerce/src/payment-reference.ts`: comment only; commerce is parked (ADR 0104). Not changed.

Sent to the provider, matched or stored:
- `packages/platform-core/src/payments/paystack.ts` `initializeTransaction`: the new boundary guard (closed reason `reference_conflict`, no provider call) and the existing check that the returned reference equals the sent one.
- `packages/platform-core/src/payments/paystack.ts` `verifyTransaction`: `GET /transaction/verify/<encoded ref>`; the returned reference is compared by the domain.
- `packages/platform-core/src/payments/payments.ts` `start` (registry by reference), `confirm`, `verifyTransfer`, `handleWebhook` (`charge.success` looks up the exact `data.reference`; no format check, so old and new references both reconcile).
- `apps/local-guest/src/guest-server.ts` `/webhooks/paystack` (~line 5006): `getCheckoutSessionByReference`, then the bank transfer fallback `getSessionByReference`.
- `apps/web/src/card-payment-application.ts`: `initializePaystackCheckout` (retry, now with re-mint), `initializePeriodPaystackCheckout`, `verifyAndConfirm`, `verifyAndConfirmPaystack`, `periodOfferIdForReference`.
- `domains/shortlet/src/card-payment.ts`: `getCheckoutSession`, `getCheckoutSessionByReference`, `verifyAndConfirmCardPayment` (find by reference, processed-reference check, mismatch check), `updateCheckoutUrl`, `remintUnboundCheckoutReference` (new), and the derived placeholder URL `https://checkout.psp.example.com/pay/<ref>`.
- `apps/local-guest/src/shortlet-app.ts`: chat card start (~line 1283), assistant runtime `verifyAndConfirm(session.pspReference)` (~lines 1556-1559), the card return (~line 5560).
- `apps/local-guest/src/fixture.ts` (~line 533): deterministic local PSP; verify echoes the reference.
- `apps/local-guest/src/guest-server.ts` (~line 4693): local checkout redirect `?reference=`.
- `apps/local-guest/src/local-bank-transfer-provider.ts`: local transfer provider, echoes the reference.
- `domains/shortlet/src/bank-transfer.ts` (~line 618): transfer result reference compared with `session.transferReference`.
- `apps/web/src/cancellation-application.ts` (~line 42), `apps/web/src/relocation-application.ts` (~line 30), `domains/shortlet/src/extended-stay-changes.ts` (~lines 148, 285-290): refund source reference, read only.
- Stored: `domains/shortlet/src/guest-interaction-store.ts` tables `guest_checkout_sessions.psp_reference` (non-unique index), `guest_period_payment_sessions`, `guest_period_payments`, `guest_period_payment_refunds`, `guest_processed_psp_references` (primary key). No DDL change; existing rows keep their stored value.
- Exported: `apps/cloudflare/src/do-export.ts` (plaintext export, ADR 0096).
- Audit: `card_payment.checkout_initialized` records `pspReference` (pre-existing, inside the ADR 0096 `audit_log` payload exemption). The new `card_payment.reference_reminted` records the checkout id only.
- Tests and fixtures: listed under Changes below.

Sites were checked by grep and by reading the code paths above. Owner-payable and back-office projections were matched by grep only and were not read line by line.

### ADR conclusion

- **ADR 0046** (one live attempt; replacement only after the PSP confirms technical failure; unique reference; locked idempotent transition; window not reset; old success refunded): the re-mint is permitted here. The only case is an `initiated` attempt whose Paystack initialize was refused, so no provider transaction exists for its reference. The replacement is unique (checked against all stored references), keeps the checkout id, amount and Payment Window (expiry checked, not reset), is persisted to the same row, and the old reference is never sent again. A bound attempt (provider environment recorded) or a paid attempt is never re-minted. The refusal is the provider's technical-failure answer. No ADR text was amended.
- **ADR 0049** (fresh PSP-hosted checkout; unique booking-specific reference; one live attempt; a terminal decline may be replaced before the deadline without resetting it): consistent. Every attempt still gets a unique reference. No card data is stored.
- **ADR 0075 and `docs/agents/coding-standards.md`** (bearer credentials; minimal audit): the guard message and the re-mint audit carry no reference or URL. The re-mint audit records the checkout id, offer id and time only.
- **ADR 0096** (export keeps the four payment-reference columns plaintext): the columns keep their shape. New rows hold the new format; legacy rows keep the old one. No export code change is needed.
- **ADR 0087 and 0088** (Paystack; verification by reference; webhook only a prompt): verification and webhook logic are unchanged; the exact-match lookup reconciles both formats.
- **ADR 0044** (20-minute Payment Window): preserved; the re-mint refuses after the window.
- **ADR 0047** (bank transfer with expiring accounts): not changed. The transfer charge still uses an underscore reference (open issue 1).
- **ADR 0106** (concierge controls): the chat card tests run with the assistant runtime enabled, on the staging-like guest, on the 27 Oct 2026 clock, with a true cold restore (a new `LocalGuestEnvironment` over the same file database) before the resume and the webhook steps.

No ADR amendment note was added, because the re-mint fits ADR 0046's replacement rule and nothing needed overriding.

### Changes

- `domains/shortlet/src/card-payment.ts`: `PLATFORM_PSP_REFERENCE_PATTERN`, `mintCardPspReference`, `remintUnboundCheckoutReference`, and the new minted reference.
- `domains/shortlet/src/period-payment.ts`: period reference format.
- `apps/web/src/card-payment-application.ts`: retry re-mint, only for initiated, unbound, legacy-format attempts; imports.
- `packages/platform-core/src/payments/paystack.ts`: `PAYSTACK_ACCEPTED_REFERENCE_PATTERN` guard in `initializeTransaction` (`reference_conflict`, before any fetch).
- Existing tests updated to the new format: `test/platform-payments.test.ts` (`psp_ref_*` references now `psp-ref-*`), `test/paystack-pilot.test.ts` (`/^psp_ref_/` now `/^psp-ref-/`), `test/helpers/paystack-http.ts` (fake default reference). Leak-check lists now also forbid `psp-ref-`: `test/back-office-bookings.test.ts`, `test/back-office-owner-payables.test.ts`, `test/back-office-reservation.test.ts`, `test/card-checkout-failure-diagnostic.test.ts`, `test/payment-continuation-diagnostic.test.ts`, `test/pay-each-demo-billing-period.test.ts`, `apps/cloudflare/test/card-checkout-log.spec.ts`, `apps/cloudflare/test/payment-continuation-log.spec.ts`.
- Shared journey extracted from `test/assistant-paystack-checkout-contact.test.ts` into `test/helpers/paystack-checkout-journey.ts` (no behaviour change; that file's 9 tests still pass).
- New: `test/paystack-psp-reference-format.test.ts` (10 tests).

### Tests run (exact commands and counts)

- `env -u LLM_API_KEY npx tsx --test test/paystack-psp-reference-format.test.ts`: tests 10, pass 10, fail 0. The first run, before the implementation, failed at module link (`PLATFORM_PSP_REFERENCE_PATTERN` not exported), the expected red state. Later failing runs were fixture problems (payer attribution metadata, the chat retry surface after a refused start, and a deposit outcome for the stay payment), corrected in the test and not in the product code.
- `env -u LLM_API_KEY npx tsx --test test/assistant-paystack-checkout-contact.test.ts`: tests 9, pass 9, fail 0 (after restoring the `PHONE` import; an earlier batch failed on that missing import).
- Batch A: `env -u LLM_API_KEY npx tsx --test test/assistant-paystack-checkout-contact.test.ts test/paystack-pilot.test.ts test/platform-payments.test.ts test/paystack-psp-reference-format.test.ts test/card-checkout-failure-diagnostic.test.ts test/payment-continuation-diagnostic.test.ts`: tests 79, pass 79, fail 0.
- Batch B: `env -u LLM_API_KEY npx tsx --test test/guest-process-restart.test.ts test/integrate-card-payment-application.test.ts test/pay-each-demo-billing-period.test.ts test/later-period-payment-routes.test.ts test/back-office-bookings.test.ts test/back-office-owner-payables.test.ts test/back-office-reservation.test.ts`: tests 56, pass 56, fail 0.
- `env -u LLM_API_KEY npm run check` after all edits: exit 0. An earlier run exited 1 only because of the missing `PHONE` import, now fixed.
- `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/card-checkout-log.spec.ts apps/cloudflare/test/payment-continuation-log.spec.ts apps/cloudflare/test/demo-extended-stay.spec.ts`: test files 3 passed; tests 8 passed.
- `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/pilot-worker.spec.ts`: test files 1 passed; tests 4 passed.

Not run: full `npm test` and full `npm run test:workers` (pre-merge, once per batch, per the Test scope). The real-Chrome files were not run, because this change does not alter those screens.

### Staging bundle (built from this worktree after d6724a4)

Run from `apps/cloudflare` with `env -u LLM_API_KEY -u COMMERCE_ENABLED -u RESEND_API_KEY -u GEMINI_API_KEY` and the required `SHORTLET_DEMO`, `CONCIERGE_MODE`, `LLM_*`, `CONCIERGE_DAILY_MODEL_CALL_CAP=1500` and `CF_ACCESS_*` values, then `node ../../node_modules/@cloudflare/vite-plugin/bin/cf-vite build --mode staging`: exit 0; `index.js` 2,894.81 kB.

Descriptor check (`apps/cloudflare/.cloudflare/output/v0/workers/default/worker.config.json`; values were not printed, only compared or typed):
- name `shortlet-pilot-staging`: PASS.
- secret-type bindings are exactly `PAYSTACK_SECRET_KEY`, `LLM_API_KEY`, `SHORTLET_GUEST_CODE_HASHING_KEY`, `OPS_SHARED_SECRET`: PASS.
- `COMMERCE_ENABLED` text, equal to `false`: PASS.
- `RESEND_API_KEY` and `GEMINI_API_KEY` absent: PASS.
- `CONCIERGE_DAILY_MODEL_CALL_CAP` equal to 1500: PASS.
- `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` equal to the given values: PASS.
- `LLM_BASE_URL`, `LLM_MODEL`, `LLM_PROVIDER_LABEL`, `CONCIERGE_MODE`, `SHORTLET_DEMO` equal to the given values: PASS.
- `SHORTLET_PUBLIC_ORIGIN` host ends in `.workers.dev`: PASS.
- `PAYSTACK_ENVIRONMENT` equal to `test`: PASS.
- The bundle contains `psp-ref-` and no `psp_ref_${` template: PASS.

Not verified: loading the bundle in local workerd, live staging behaviour, the owner's deploy, and the real Paystack answer to an underscore reference.

### Open issues (not fixed in this batch)

1. Pay with Transfer references `exp_trf_<hex>` (`domains/shortlet/src/bank-transfer.ts`) contain an underscore and are sent to Paystack's Charge API as `reference`. They likely fail the same way. The guard is not applied to `createTransferAccount`, and the scheme is unchanged. Needs its own decision (ADR 0047 idempotency and existing transfer rows).
2. Later Billing Period attempts stuck with a legacy reference block retries for their 20-minute window (`A live attempt already exists`), then are superseded. They self-heal and are not re-minted.
3. A refused chat start leaves the card on the `payment:checkout` surface with a `verify-return` button, not the start button. The guest resumes through `/payments/offers/<id>/continue`, which calls `initializePaystackCheckout`. Chat UX is unchanged here.
4. Pre-existing: the `card_payment.checkout_initialized` audit includes `pspReference`, allowed only under the ADR 0096 `audit_log` exemption.
