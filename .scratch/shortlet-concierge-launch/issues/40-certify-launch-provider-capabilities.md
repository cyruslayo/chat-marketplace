# Certify launch payment, identity, and messaging capabilities

Status: ready-for-human
Type: HITL
User stories: 15, 21, 26–31, 107

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Execute and document production-equivalent certification with selected PSP, identity, and messaging providers. Prove reference expiry, timing boundaries, late success, refunds, settlement, ambiguous identity outcomes, delivery callbacks, invalidation, verification, and operational escalation before enabling each capability.

## Acceptance criteria

- [ ] Named provider, environment, configuration, evidence, observed behaviour, exceptions, owner, and expiry are recorded per capability.
- [ ] Bank references demonstrably become non-payable at the required deadline; documentation or ordinary sandbox success alone is insufficient.
- [ ] Payment, identity, and channel failure simulations produce the platform's required authoritative and recovery outcomes.
- [ ] Unsupported capabilities remain disabled and any accepted limitation is reflected in the capability matrix and launch policy.

## Blocked by

- [Issue 11](11-expire-transfer-and-refund-late-payment.md)
- [Issue 12](12-capability-gate-ussd-and-authentication.md)
- [Issue 34](34-project-artifacts-through-whatsapp.md)
- [Issue 39](39-prove-external-provider-contracts.md)
