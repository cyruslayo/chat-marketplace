# Platform Payments: move the Paystack port, webhook, transfer verification and receipt store out of shortlet

Status: ready-for-agent
Type: task
Blocked by: 09a
Requested: 14 Oct 2026
Unlocks: 22
Lane: C: Platform services
PRD: `../PRD.md`

## Why

Payments live in `domains/shortlet` (PRD, Diagnosis 7); commerce must not import shortlet.

## What to build

1. Create a deep `Payments` module in `packages/platform-core` with a small interface (`start(intent)`, `confirm(reference)`, `handleWebhook(request)`, `verifyTransfer(...)`) that hides `domains/shortlet/src/paystack.ts`, the transfer-verification parts of `bank-transfer.ts`/`manual-transfer.ts`, and `receipt-blob-store.ts`.
2. Booking ledger, reservations, payment windows and owner payables stay in shortlet and react to payment outcomes.
3. Hosts (`apps/pilot`, `apps/cloudflare`) construct Payments once and pass it to packs.

## Out of scope

- Commerce split payments (22).

## Acceptance criteria

- AC1: `domains/shortlet` has no Paystack HTTP or webhook-signature code; it calls Payments.
- AC2: Payment intents carry a domain id and reference so outcomes route to the right pack.
- AC3: All existing card, bank-transfer and manual-transfer tests pass unchanged.
- AC4: No secret key or card data appears in audit or logs (ADR 0075).

## Tests

Platform payments tests reusing `test/helpers/paystack-http.ts` and `bank-transfer-provider.ts`; existing flow tests.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0087-select-paystack-for-pilot-shortlet-payments.md` | Provider-neutral port. |
| `docs/adr/0088-offer-card-and-bank-transfer-through-paystack.md` | Methods. |
| `docs/adr/0090-accept-manual-bank-transfer-verified-against-the-credit.md` | Manual transfer. |
| `docs/adr/0096-export-payment-references-in-plaintext.md` | Reference export unchanged. |
| `docs/adr/0075-secure-and-minimize-agent-interaction-data.md` | No credentials in logs. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
