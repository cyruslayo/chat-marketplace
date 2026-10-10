# Merge ADRs 0088–0090 and mark superseded ADRs

Status: ready-for-agent
Type: task
Blocked by: none

## What to build

ADRs 0088 (card and bank transfer through Paystack), 0089 (collect guest payments, pay owners the agreed amount, margin on top) and 0090 (manual transfer with receipt) exist only on branch `adr/payments-and-margin`. Main still describes the older operator-commission model, while current branches build the margin model. Make main tell one story.

## Acceptance criteria

- [ ] ADRs 0088, 0089 and 0090 are on main.
- [ ] ADRs 0021, 0024, 0025, 0026, 0062 and 0083 carry a `status: superseded by ADR-0089` header; ADR 0063 notes which parts are superseded.
- [ ] `domains/shortlet/CONTEXT.md` terms (owner payable, margin, agreed amounts) match ADR 0089.
- [ ] The user approves the merge before it happens.
