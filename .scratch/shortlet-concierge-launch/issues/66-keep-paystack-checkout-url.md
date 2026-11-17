# Keep the approved Paystack checkout address across a cold restore

Status: ready-for-agent
Type: task
Blocked by: 65 (same branch stack)
Requested: 17 Nov 2026

## Why

Found while building issue 65 (its Comments, deviation 5). The durable checkout session does not keep the Paystack `authorization_url`:

- `#persistSession` (`domains/shortlet/src/card-payment.ts`, around line 271) does not store `checkoutUrl`, and the durable row in `guest_checkout_sessions` (`domains/shortlet/src/guest-interaction-store.ts`, around line 442 and 1211) has no column for it. A restored session gets a placeholder `https://checkout.psp.example.com/pay/<ref>` (around lines 790 and 813).
- Every Worker request is a cold restore (ADR 0106), so `/payments/offers/<id>/continue` calls Paystack `POST /transaction/initialize` again with the same reference each time the guest follows the link. Issue 65's test 3 pins this as `[ref, ref]`.
- The reference, the checkout session and the Payment Window do not change, and the live staging journey of 17 Nov 2026 paid successfully. But Paystack's answer to a repeated reference is not verified offline, and an extra provider call per click adds latency and a failure point inside the 20-minute Payment Window (ADR 0044). There is also a remint path (`card-payment.ts`, around line 421) whose interaction with a repeated initialize is not documented.

## What to build

1. **Survey first** (record in Comments): every path that sets, reads or remints `checkoutUrl` and `pspReference`; what the Paystack adapter does with a repeated reference today (including any duplicate-reference error handling and the remint path); which tests pin the current behaviour.
2. **Persist the approved address.** Store the validated `authorization_url` with the durable checkout session when the server receives it from Paystack, in a new nullable column on `guest_checkout_sessions`, added the way `contact_email` was added (the guarded `ALTER TABLE ... ADD COLUMN` in the store, around line 729), plus whatever schema migration the shortlet migration list needs so the Worker store gets it too.
3. **Reuse it.** `/continue` reuses the stored address while the same Live Payment Attempt is active and inside its Payment Window; it initializes Paystack only when no address is stored, or after a remint gives a new reference (ADR 0046).
4. **Validate on read.** A stored address is used only if it is `https:` on the approved Paystack checkout host for the provider environment the session records (`providerEnvironment`). Anything else fails closed: initialize again rather than redirect to it.
5. **Never log or echo it.** The address is a payment-page link. It is never written to logs, audits, the timeline, exports' guest-visible text or any guest response body (ADR 0075). Check the daily export: if `guest_checkout_sessions` is exported, decide with the owner whether the column is excluded (record the decision).

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0087 | The server initializes Paystack and issues the only `authorization_url`; the browser never supplies the destination. | Steps 2 to 4. |
| 0046 | One Live Payment Attempt; a superseded or reminted reference is ignored. | Step 3; AC 3. |
| 0044 | Payment Window, 20 minutes after Accept Offer. | Step 3; AC 4. |
| 0106 | Every Worker request is a cold restore. | Why; AC 1. |
| 0075 | No bearer or provider material in logs, audits or interaction data. | Step 5; AC 6. |
| 0096 | Export coverage and its exemptions. | Step 5. |

## Acceptance criteria

Each is its own `test()` in `test/card-checkout-url-persistence.test.ts` (new), with a cold restore before every event, clock 2026-10-27, a staging-like guest, and a fake Paystack client that counts initialize calls.

1. After a cold restore, following `/continue` twice for the same attempt calls Paystack initialize once and redirects both times to the same stored address.
2. The stored address survives a restore of the durable row (node SQLite store and the Worker store).
3. A remint (new reference) initializes Paystack again and stores the new address; the old address is never used again.
4. After the Payment Window closes, `/continue` does not redirect to the stored address (the existing expiry behaviour holds).
5. A stored address on another host, another scheme or the wrong provider environment is not used (fail closed: initialize again).
6. The address appears in no log line, audit record, timeline entry or guest response body.
7. Issue 65's test 3 is updated deliberately from `[ref, ref]` to one initialize call, with the reason recorded in Comments.

## Verification

- `env -u LLM_API_KEY npm run check`.
- `env -u LLM_API_KEY npx tsx --test test/card-checkout-url-persistence.test.ts test/card-checkout-after-email.test.ts test/assistant-paystack-checkout-contact.test.ts` plus the payment-continuation, Paystack adapter and store tests the survey names.
- Workers: the export and migration specs that cover `guest_checkout_sessions` (`npm run test:workers -- <spec path>`, one spec per command).
- Real Chrome, solo: `test/paystack-real-browser.test.ts`.
- Live, after the owner's deploy: on staging, follow the chat link and the page link to checkout; both reach `checkout.paystack.com`. Stop before card entry.

## Out of scope

- Bank transfer and manual transfer (ADR 0088).
- The known gap that a late `charge.success` on a superseded reference is ignored (ADR 0046).

## Comments

- Owner, 17 Nov 2026: "let us fix it all" — release this issue to build on top of 65.
