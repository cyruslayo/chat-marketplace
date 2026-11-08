# Confirm the launch decisions approved by the council

Status: ready-for-human
Type: grilling
Blocked by: none
Requested: 8 Nov 2026

## Parent

[PRD](../PRD.md), "Decisions taken for this path".

## Why

The council approved the work, so the open decisions can be settled now. An agent must not invent them (`docs/agents/domain.md`), so the owner confirms each one here, in one sitting. Each has a recommended answer.

## Decisions to confirm (recommended answer first)

1. **D1 Launch scope:** Short Stays (1-29 nights) at launch; Extended Stays fail closed in production until counsel's text is in `monthly-stays/02`. *(Alternative: record counsel's text first and launch both.)*
2. **D2 Hosting:** production is Cloudflare only; `cloudflare-deployment/16` closes as "no data to migrate".
3. **D7 Same-day cutoff:** every pilot unit's Contractual Check-In Window starts at 14:00 (ADR 0031); per-unit cutoff (`shortlet-concierge-launch/48`) is post-launch.
4. **D8 Payment methods:** card through Paystack hosted checkout plus manual bank transfer verified in the back office (ADR 0090). Paystack Pay with Transfer is post-launch.
5. **D4 Late payments:** a success on a superseded, expired or non-designated reference is recorded, the operator is alerted, and the refund is issued from the Paystack dashboard by the operator, with the refund recorded in the back office. *(Alternative: automatic refund through the Paystack refund API; more code and a provider contract to certify.)*
6. **Concierge model in production:** the staging configuration (GPT-6 Luna via OpenRouter, daily cap 1500) is accepted; this closes `demo-launch/03` (benchmark acceptance).
7. **Audit decisions:** take the recommended answers in `shortlet-concierge-launch` 52 (payment references in audit), 54 (card-number redaction width) and 55 (rows masked before PR 105).
8. **D11 Parity:** `assistant-concierge-parity` 04, 05, 13 are post-launch.

## Acceptance criteria

- [ ] AC1: Each decision above has the owner's answer recorded under `## Answer` with the date.
- [ ] AC2: Where an answer changes an ADR (for example D1 against ADR 0092 as amended, or D5 against ADR 0046), the ADR gets a dated amendment note.
- [ ] AC3: Issues 52, 54, 55 and `demo-launch/03` carry a pointer to this answer and are resolved or updated.

## Comments
