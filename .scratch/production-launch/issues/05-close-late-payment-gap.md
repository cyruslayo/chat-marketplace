# Record and refund every success on a minted reference (ADR 0046 gap)

Status: ready-for-agent
Type: AFK
Blocked by: 02 (decision 5: manual or automatic refund)
Requested: 8 Nov 2026

## Parent

[PRD](../PRD.md), decision D4.

## Why

ADR 0046: "All references remain monitored. Success from any superseded, expired, or non-designated attempt is recorded and fully refunded to its original source; it never confirms the booking."

What main (16d592e) already does: when the webhook or verify path finds the checkout session, a late or superseded success is recorded for reconciliation (`domains/shortlet/src/card-payment.ts`, `#markLatePaymentReconciliation`, around lines 540-549), and period payments record refunds (`domains/shortlet/src/period-payment.ts:220-343`).

The gap (tester notes of 29 Oct 2026, "Known gaps" 1 and 4, `.scratch/concierge-agent-controls/validation/2026-10-29/tester-readiness-and-todo.md`): a reference that was **minted but never recorded as an attempt** is not monitored. That happens when the Paystack initialize call times out (`PAYSTACK_CHECKOUT_PROVIDER_TIMEOUT_MS`, 20 s, reported as `provider_unreachable`) or when a refused attempt is re-minted (d6724a4). If the guest still pays on that reference, `charge.success` is ignored: nothing is recorded or refunded. With live money that is a guest's money lost silently. Related: a stuck initiated attempt on a later period blocks a retry for 20 minutes (gap 4).

## What to build

Start with a short written trace (in Comments) of every path that mints a reference, then:

- Record an attempt **before** the provider call, as `indeterminate`, so every minted reference is known.
- On retry, ask Paystack about the indeterminate reference (verify) before initializing a new one; a retry during an in-flight start joins it rather than minting another.
- Pass an `AbortSignal` to the payments start so a timeout really stops the call.
- A `charge.success` on any known non-designated reference is recorded for refund and raises an operator alert, as decided in issue 02 (manual refund from the Paystack dashboard, recorded in the back office), and never confirms.
- A `charge.success` on a completely unknown reference is logged with a closed reason (no ids, ADR 0075) and alerts the operator.

## Acceptance criteria

- [ ] AC1: A start that times out leaves an `indeterminate` attempt with its reference recorded.
- [ ] AC2: A later `charge.success` on that reference records a refund obligation and alerts the operator; the booking is not confirmed by it.
- [ ] AC3: A retry after a timeout verifies the indeterminate reference first; if it succeeded, the booking confirms from it and no new reference is minted.
- [ ] AC4: Two concurrent starts for one offer mint one reference.
- [ ] AC5 failure path: `charge.success` for an unknown reference never confirms anything and writes a closed log line with no id, URL or token.
- [ ] AC6: A stuck initiated later-period attempt no longer blocks a retry once verified as not paid.
- [ ] AC7: Covered on both Node and the Worker (`apps/cloudflare/test/*.spec.ts`), with a cold restore between start and webhook.

## ADRs to read

0044 (grace), 0045, 0046, 0075, 0087, 0088, 0089, 0106 (cold restore).

## Comments
