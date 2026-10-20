# Commerce checkout through platform Payments (Paystack split and manual transfer)

Status: ready-for-agent
Type: task
Blocked by: 04, 15, 21
Requested: 14 Oct 2026
Unlocks: 23
Lane: D: Commerce
PRD: `../PRD.md`

## Why

Paid order state must come from a verified provider result, not a client callback (ADR 0002 conditions, slice 04).

## What to build

Checkout command for one Store Cart → Merchant Order → platform `Payments.start` with the store's subaccount and commission (from slice 04's named source); confirmation via webhook/verify moves the order to paid. Manual transfer fallback per ADR 0090.

## Out of scope

- UI (23, 27).

## Acceptance criteria

- AC1: An order is marked paid only after a verified provider result.
- AC2: A store without an active subaccount cannot take a paid order.
- AC3: The commission comes from the configured source, not a literal.
- AC4: Duplicate webhooks do not double-confirm.

## Tests

One test per AC using the shared Paystack test helper.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| ADR from slice 04 | Split structure. |
| `docs/adr/0088-offer-card-and-bank-transfer-through-paystack.md` | Methods. |
| `docs/adr/0090-accept-manual-bank-transfer-verified-against-the-credit.md` | Fallback. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments

### 20 Oct 2026 — stays-first launch

Parked, not cancelled, by the owner's stays-only launch decision in [issue 30](30-defer-commerce-until-stays-launch.md). Commerce stays off in every public deployment until the owner reopens it and the recorded prerequisites are met. Status remains `ready-for-agent`, still blocked by slice 04; this status does not authorize starting parked work.
