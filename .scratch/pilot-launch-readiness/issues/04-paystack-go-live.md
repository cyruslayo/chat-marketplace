# Paystack live account, certification and transfer access

Status: ready-for-human
Type: task
Blocked by: 03

## Acceptance criteria

- [ ] Live Paystack business account approved, with the merchant agreement covering collection on behalf of owners (ADR 0089).
- [ ] Card checkout certified in live mode with a real low-value payment and refund (guest-payments P2 AC4).
- [ ] Pay with Transfer API access requested, and issue 47 in `.scratch/shortlet-concierge-launch/issues/` updated with the outcome. Until then, manual transfer with receipt (ADR 0090) is the transfer route.
- [ ] Webhook URL and secret configured per `docs/pilot-deployment.md`, with no keys in logs (ADR 0075).
