# Capability-gate USSD and payment authentication

Status: resolved
Type: AFK
User stories: 30

## ADR Compliance
- ADR 0002 & 0049: Fresh PSP checkout, zero raw credentials (PAN, CVV, PIN, OTP) exposed or persisted.
- ADR 0048: Authoritative Payment Capability Certification checked again prior to USSD session initialization.
- ADR 0050: Risk-based card authentication outcome mapping preserved safely.
- ADR 0068 & 0077: Unified capability state projections across web, agent, and messaging experiences.

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Expose USSD only when its exact provider capability has an active Payment Capability Certification, and preserve PSP- and issuer-risk-based card authentication without inventing a platform authentication rule that conflicts with the hosted checkout.

## Acceptance criteria

- [x] An uncertified, expired, or suspended payment capability is absent from all channels.
- [x] Certification status is authoritative, versioned, auditable, and checked again before initialization.
- [x] Card authentication outcomes map safely without exposing restricted data or bypassing booking verification.
- [x] Capability changes project consistently to conventional, agent, and permitted messaging experiences.

## Answer

Runtime capability state is linked to authoritative provider certification evidence and fails closed on missing, expired, sandbox-only, or suspended capability. USSD remains disabled by default for launch because Issue 40 contains no launch certification enabling it; a hypothetical certified path rechecks certification immediately before trusted provider initialization and derives amount, payer, tenant, currency, and deadline from the accepted offer. Card, bank transfer, and USSD share one Live Payment Attempt authority. Card authentication is normalized only at a trusted provider/server boundary, preserves frictionless and challenged step-up outcomes, minimizes restricted data, and never bypasses independent payment and booking verification. Conventional web, Weaver/agent, and permitted WhatsApp projections derive from the same capability artifact/state. Validation: focused certification/capability/card tests passed; full suite 349 passed, 0 failed, 0 skipped, 0 todo; `npm run check`, `npm run verify:weaver`, and `git diff --check` passed.

## Blocked by

- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 11](11-expire-transfer-and-refund-late-payment.md)
