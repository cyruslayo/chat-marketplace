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
