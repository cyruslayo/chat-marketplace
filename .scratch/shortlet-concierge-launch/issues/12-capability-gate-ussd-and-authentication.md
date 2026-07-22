# Capability-gate USSD and payment authentication

Status: ready-for-agent
Type: AFK
User stories: 30

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Expose USSD only when its exact provider capability has an active Payment Capability Certification, and preserve PSP- and issuer-risk-based card authentication without inventing a platform authentication rule that conflicts with the hosted checkout.

## Acceptance criteria

- [ ] An uncertified, expired, or suspended payment capability is absent from all channels.
- [ ] Certification status is authoritative, versioned, auditable, and checked again before initialization.
- [ ] Card authentication outcomes map safely without exposing restricted data or bypassing booking verification.
- [ ] Capability changes project consistently to conventional, agent, and permitted messaging experiences.

## Blocked by

- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 11](11-expire-transfer-and-refund-late-payment.md)
