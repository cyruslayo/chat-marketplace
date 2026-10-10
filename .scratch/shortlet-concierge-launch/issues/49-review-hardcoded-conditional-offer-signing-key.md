# Review the hardcoded conditional-offer signing key

Status: needs-triage
Type: AFK
User stories: 35, 85–87

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## Why

`domains/shortlet/src/conditional-offer.ts` signs confirmation tokens with the literal key `"conditional_offer_secret"` (`createConfirmationToken`, line 27; `decodeConfirmationToken`, line 39). The key is in the repository, so anyone can compute the signature. This note is a read-only reachability review. No code was changed.

## Reachability (read-only, checked against this branch)

- **On a production path.** `ConditionalOfferManager.issue` creates the token. It is called from:
  - `apps/local-owner/src/local-owner-environment.ts:1188`, after an operator confirms a request;
  - `apps/local-guest/src/guest-server.ts:4503`, on the guest refresh path after confirmation;
  - `apps/local-guest/src/fixture.ts:653`, the test and local helper that simulates operator acceptance.
  The production Durable Object composes both the guest environment (`LocalGuestEnvironment`, `production: true`) and the owner environment (`apps/cloudflare/src/shortlet-pilot-do.ts`, `#buildRuntime`). So issuance and acceptance both run in production.
- **The token is handed to the guest.** It appears as `confirmationToken` in the conditional-offer artifact actions (`apps/web/src/conditional-offer-artifact.ts`, about line 112) and in the offer projection. That makes it a bearer credential in interaction state. ADR 0075 keeps restricted material out of general interaction state, and the coding standards list confirmation tokens as bearer credentials that must be stored as a hash or omitted.
- **Acceptance.** `acceptOffer` (about lines 393–500) requires exact equality with the stored `offer.confirmationToken` (step 7) before it decodes the token. No forgery path to acceptance was found in this review. The hardcoded key is therefore a defence-in-depth and hygiene gap, not a demonstrated bypass.
- **Payload.** The token is base64 JSON, not encrypted. It carries `actorId`, `tenantId`, `offerId`, the total due in kobo and `expiresAt`. Anyone holding the token can read those fields.

## What to build (after triage)

- Remove the literal key. Either take a per-deployment secret from configuration, or drop the HMAC and keep the stored random token, storing only its hash (AGENTS: never roll a custom security primitive; use `node:crypto` or an established pattern).
- Keep the raw confirmation token out of general interaction projections and logs (ADR 0075). This needs a design decision on how the guest's accept action carries the token.
- Add tests that a token is refused with the wrong key, and that a raw token does not appear in logs or projections.

## Acceptance criteria (proposed, pending triage)

- [ ] A confirmation token issued under one deployment's key is refused by another deployment (failure path).
- [ ] The offer record stores a hash of the confirmation token, not the token itself, and acceptance still requires the matching token.
- [ ] No raw confirmation token appears in the interaction projection, audit records or logs (ADR 0075).
- [ ] No hardcoded signing key remains in `domains/shortlet/src/conditional-offer.ts`.

## Needs user

- Whether the HMAC is kept (with configuration-held key) or replaced by a stored hash.
- Severity. This review found no bypass, so a security review should set the priority.
