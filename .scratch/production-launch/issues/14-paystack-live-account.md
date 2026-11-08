# Paystack live account and certification

Status: ready-for-human
Type: task
Blocked by: 13
Requested: 8 Nov 2026
Wraps: [pilot-launch-readiness/04](../../pilot-launch-readiness/issues/04-paystack-go-live.md)

## Parent

[PRD](../PRD.md). This is probably the longest pole: Paystack's business verification needs the legal entity and documents.

## What to do (owner)

- Complete Paystack business verification and get a live secret key (`sk_live_...`).
- In the live dashboard: set the webhook to `<production origin>/webhooks/paystack`, subscribe to `charge.success` only (AGENTS.md "Paystack").
- Note the bank account that receives manual transfers (ADR 0090) for the guest instructions.

## Acceptance criteria

- [ ] AC1: Live account approved, with the date recorded (never the key).
- [ ] AC2: Webhook URL and event subscription set on the live account.
- [ ] AC3: Pilot 04's other criteria met or explicitly deferred (Pay with Transfer is post-launch, D8).

## Comments
