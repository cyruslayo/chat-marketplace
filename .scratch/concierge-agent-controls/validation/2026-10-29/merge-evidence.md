# Merge evidence: fix/staging-checkout-journey into integration/concierge-controls

Date: 2026-10-29. Offline only. No push, no merge to main, no deploy, no Cloudflare or wrangler commands, no staging bundle build.

## Pinned commits

| Role | Commit |
| --- | --- |
| Base: integration/concierge-controls (pinned tip) | 2f7ae126bb9bf62ddfaa28074e3d3e179350d19f |
| Source: fix/staging-checkout-journey | f4500c641d8fbea42ab3f10dd416a02d58f784c9 |
| Merge base of the two | 26bafd5559e1d0f8abd73252d247a4c3e2cdd818 |
| Result: merge/staging-fixes HEAD | 362080c535596507f5c6771c2dde102bf9097a33 |

Worktree: C:\AI2026\chat-marketplace-merge, branch merge/staging-fixes. `node_modules` (root) and `apps/cloudflare/node_modules` are directory junctions to the main checkout's installs, mirroring the fixes worktree. No packages were installed.

Dry run (`git merge-tree --write-tree`): exactly two conflicting paths, as expected: `apps/local-guest/src/shortlet-app.ts` and `test/helpers/guest-date-fixtures.ts`. Every other path merged automatically.

## Conflict resolutions

### apps/local-guest/src/shortlet-app.ts (5 hunks)

1. Timeout constant and card-checkout reason types. Kept integration's `PAYSTACK_CHECKOUT_PROVIDER_TIMEOUT_MS` (20 s, ADR 0106: no new outcome code) and the fixes' `CardCheckoutFailureReason`, `CardCheckoutFailedEvent`, `cardCheckoutProviderStatusClass` and `cardCheckoutFailureReason`. Each keeps its own doc comment.
2. Class field. Both `#paystackCheckoutTimeoutMs` and `#onCardCheckoutFailed` are kept.
3. Constructor option. Both `paystackCheckoutTimeoutMs` and `onCardCheckoutFailed` are accepted.
4. Constructor body. Integration's positive-integer guard on the timeout is kept, and the fixes' observer assignment is kept.
5. Provider call and contact pre-check. Integration's `#boundProviderCall` is kept, and the fixes' `#paymentContactPrompt` (phone first, then email, only for an accepted offer inside its payment window) follows it.

Resolution beyond a plain keep-both: in `#boundProviderCall` the timeout now rejects with `new PaystackProviderFailure("provider_unreachable", ...)` instead of a plain `Error`. Without this, the fixes' classifier (`cardCheckoutFailureReason`) would report a bounded timeout as `unclassified`. `provider_unreachable` is an existing closed reason of `PaystackProviderFailureReason` (packages/platform-core/src/payments/paystack.ts), so no new policy string was introduced. The internal message is never reported; the observer receives only the closed reason, and the guest still gets the existing `ACTION_NOT_AUTHORIZED` copy with the run released in `finally`.

### test/helpers/guest-date-fixtures.ts (2 hunks)

1. `STAGING_GUEST_CONFIG` (integration) is kept and used. The fixes' inline literal of the same two nulls was dropped to avoid a duplicate fixture (coding standard: no duplicated fixtures). The `datedFixture` options carry both `stagingGuest` and the fixes' `paystackClient`.
2. The fixes' `openConfig`, `databasePath` and `trueRestartedDatedApp` are kept, with the staging spread switched to `STAGING_GUEST_CONFIG`. `wireDatedApp` keeps integration's `paystackCheckoutTimeoutMs` option.

Line endings: `core.autocrlf=true` produced CRLF working copies. The committed blobs are LF, as the index shows.

## Commands and counts

All test commands ran with `env -u LLM_API_KEY`.

| Command | Result |
| --- | --- |
| `env -u LLM_API_KEY npm run check` (run after the merge; also before the commit) | exit 0 (tsc root, apps/cloudflare, tsconfig.test, tsconfig.tooling, worker bundle guard) |
| `npx tsx --test` on the 9 named files, plus `test/assistant-thread-lock.test.ts`, `test/guest-session-runtime-limit.test.ts`, `test/guest-turn-timeout.test.ts` (integration's issue 06 files, which touch the bounded Paystack path and the thread run lock) | tests 158, pass 158, fail 0, cancelled 0, skipped 0 (exit 0, 154 s) |
| `npx tsx --test` on the other fixes-touched test files: `back-office-bookings`, `back-office-owner-payables`, `back-office-reservation`, `pay-each-demo-billing-period`, `phase4-booking-payment-presentation`, `platform-payments` | tests 43, pass 43, fail 0 (exit 0) |
| `npm run test:workers -- apps/cloudflare/test/card-checkout-log.spec.ts apps/cloudflare/test/payment-continuation-log.spec.ts` | Test Files 2 passed (2), Tests 12 passed (12) (exit 0). The filter worked, so the fallback to the full run was not needed. |

Not run, as instructed: full `npm test`, full `npm run test:workers`, and the staging bundle build.

## Failures and classification

None. No merge-caused failure occurred in the affected set, and no failure was pre-existing. The temporary-worktree check at the integration tip was therefore not needed.

## ADR conformance table

ADRs read in full before the work: 0106 (with both amendments), 0092, 0093, 0075, 0046. Also read: `docs/agents/coding-standards.md`.

| ADR | Constraint | Hunk or code path it governs | Status |
| --- | --- | --- | --- |
| 0106 | Platform controls fail closed. No new outcome code. Gate and state checks remain authoritative. | Timeout refusal reuses `ACTION_NOT_AUTHORIZED`. `#paymentContactPrompt` only chooses an input surface and is never an authority. The gate (`resolveCardPaymentServerEvent`) still runs after it. | Conforms |
| 0106 | Guard diagnostics record closed reason codes only. | `#reportCardCheckoutFailure` and `#rejectCardCheckout` receive a `CardCheckoutFailureReason` and an optional closed status class. The bounded timeout is now `provider_unreachable`, not `unclassified`. | Conforms (after the resolution above) |
| 0106 | Assistant changes are tested with the runtime enabled and a cold restore. | `test/assistant-cold-journey.test.ts`, `test/guest-process-restart.test.ts` and `test/assistant-thread-lock.test.ts` passed. | Conforms |
| 0075 | Bearer credentials and provider text never reach logs or observers. | The observer gets `{code, reason, statusClass?}` only. `statusClass` comes from the closed `PAYSTACK_PROVIDER_STATUS_CLASSES`. `#paymentContactPrompt` returns no contact value. The bound error text stays internal. | Conforms |
| 0075 | Minimal interaction data. | `STAGING_GUEST_CONFIG` and the contact prompts carry no contact values into results. | Conforms |
| 0046 | One live payment attempt. A timed-out call must not create a second attempt, and a late success must not confirm a superseded attempt. | `#boundProviderCall` ignores a late result, and the run is released after 20 s. See the open question below. | Partly verified, see below |
| 0092 | Extended Stay and Billing Period rules. | Not changed by any resolved hunk. The `offer_not_payable` classifier maps the existing Extended Stay messages. | Not affected |
| 0093 | Guest contact and account rules. Booking and payment never require a Guest Account or sign-in. | The contact pre-check asks for phone then email only, not an account. | Conforms |

## Open question (unverified)

ADR 0046 says a guest may retry only after the PSP confirms the designated attempt is terminally failed, abandoned or expired. The integration bound (ADR 0106, 20 s) releases the run after a timeout and ignores a late result. If Paystack's initialize call completes after the bound, a checkout reference may exist at the PSP while the guest sees `ACTION_NOT_AUTHORIZED`. Whether the next attempt is blocked, and whether a late success is refunded as a superseded attempt, was not verified in this offline pass. It needs a read of `CardPaymentApplication.initializePaystackCheckout` and of the webhook path. Owner decision needed before any staging run.

## Not verified

- No test asserts that the bounded timeout now reports `provider_unreachable`. The change is verified by reading and type-checking only.
- The full `npm test` and full `npm run test:workers` are left for the owner's pre-merge gate.
- No live or staging behaviour was checked.
