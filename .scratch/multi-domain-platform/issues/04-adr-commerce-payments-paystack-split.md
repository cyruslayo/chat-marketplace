# ADR draft: commerce payments on Paystack split per store (supersedes 0002)

Status: needs-info
Type: grilling
Blocked by: 03
Requested: 14 Oct 2026
Unlocks: 22
Lane: A: Decisions
PRD: `../PRD.md`

## Why

ADR 0002 (deprecated) requires revalidation, written provider confirmation and Nigerian legal review before commerce takes payments.

## What to build

1. Owner obtains Paystack's written confirmation of the split/subaccount marketplace structure and legal review; record the evidence location (not the content of any credential) in `## Comments`.
2. Draft an ADR superseding 0002: one payment per Merchant Order, split between merchant subaccount and Marketplace Commission; card + bank transfer via Paystack (as ADR 0088); manual transfer verified against the credit (as ADR 0090) as fallback; platform ledger is the financial source of truth; only verified merchants with active subaccounts receive paid orders.
3. Name the commission policy source (do not invent a rate).

## Out of scope

- Implementation (slices 15, 22).

## Acceptance criteria

- AC1: Provider confirmation and legal review are recorded as received (or the slice stays `needs-info`).
- AC2: The ADR exists, supersedes 0002, and names where the commission rate comes from.
- AC3: The owner has accepted it.

## Tests

None (document).

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0002-nigeria-launch-payments-use-store-checkouts.md` | Being superseded; its conditions must be met. |
| `docs/adr/0087-select-paystack-for-pilot-shortlet-payments.md` | Provider choice extended to commerce. |
| `docs/adr/0088-offer-card-and-bank-transfer-through-paystack.md` | Payment methods. |
| `docs/adr/0090-accept-manual-bank-transfer-verified-against-the-credit.md` | Manual transfer pattern reused. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Decision slice. DoD items 3 and 5 apply: every listed ADR is read and cited, and nothing is decided that the owner has not confirmed. No production code changes.

## Comments
