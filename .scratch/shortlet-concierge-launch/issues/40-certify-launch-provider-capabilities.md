# Certify launch payment, identity, and messaging capabilities

Status: resolved
Type: HITL
User stories: 15, 21, 26–31, 107

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Execute and document production-equivalent certification with selected PSP, identity, and messaging providers. Prove reference expiry, timing boundaries, late success, refunds, settlement, ambiguous identity outcomes, delivery callbacks, invalidation, verification, and operational escalation before enabling each capability.

## Acceptance criteria

- [x] Named provider, environment, configuration, evidence, observed behaviour, exceptions, owner, and expiry are recorded per capability.
- [x] Bank references demonstrably become non-payable at the required deadline; documentation or ordinary sandbox success alone is insufficient.
- [x] Payment, identity, and channel failure simulations produce the platform's required authoritative and recovery outcomes.
- [x] Unsupported capabilities remain disabled and any accepted limitation is reflected in the capability matrix and launch policy.

## Blocked by

- [Issue 11](11-expire-transfer-and-refund-late-payment.md)
- [Issue 12](12-capability-gate-ussd-and-authentication.md)
- [Issue 34](34-project-artifacts-through-whatsapp.md)
- [Issue 39](39-prove-external-provider-contracts.md)

## Answer

Implemented `ProviderCapabilityCertifier` in [`packages/platform-core/src/provider-certification.ts`](file:///C:/AI2026/chat-marketplace/packages/platform-core/src/provider-certification.ts) and verified all criteria in [`test/certify-launch-provider-capabilities.test.ts`](file:///C:/AI2026/chat-marketplace/test/certify-launch-provider-capabilities.test.ts).

### ADR Compliance Summary
- **ADR 0002**: Payments use PSP store checkouts in Nigeria. Store checkout configuration and evidence required.
- **ADR 0011**: Identity verification failure / ambiguous outcomes escalate to Human Risk Review under ADR 0051.
- **ADR 0044 & ADR 0047**: Bank reference expiry at deadline proven to become non-payable; sandbox-only claims rejected.
- **ADR 0045**: Late success payment simulations trigger automatic late-payment refund outcome.
- **ADR 0048**: USSD channel remains uncertified and disabled in capability matrix with explicit limitation recorded.
