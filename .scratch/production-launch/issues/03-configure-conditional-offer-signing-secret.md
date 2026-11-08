# Sign Conditional Offer tokens with a configured secret

Status: ready-for-agent
Type: AFK
Blocked by: none
Requested: 8 Nov 2026
Wraps: [shortlet-concierge-launch/49](../../shortlet-concierge-launch/issues/49-review-hardcoded-conditional-offer-signing-key.md) (read its reachability review first)

## Parent

[PRD](../PRD.md), decision D5.

## Why

`domains/shortlet/src/conditional-offer.ts` signs and checks confirmation tokens with the literal key `"conditional_offer_secret"` (lines 41 and 70). The key is in the repository, so anyone can compute a valid signature. Issuance and acceptance both run in the production Durable Object. Tokens are also stored as single-use SHA-256 digests (ADR 0086), which limits but does not remove the risk; a public HMAC key must not reach production.

## What to build

- Inject the signing key into the Conditional Offer manager instead of the literal (constructor option; no default in production composition).
- Cloudflare: a new secret binding (for example `SHORTLET_CONDITIONAL_OFFER_KEY`) in `apps/cloudflare/cloudflare.config.ts`; Node pilot: the equivalent env var, validated at startup with a minimum length (follow `SHORTLET_GUEST_CODE_HASHING_KEY` handling in `pilot-config-core.ts`).
- Development and tests use a clearly local constant through the same option.
- Startup fails closed in staging and production when the key is missing or too short.
- Update AGENTS.md "Staging deployment": the descriptor now has **five** secret bindings. Update any test or script that asserts four.

## Acceptance criteria

- [ ] AC1: No source file outside tests contains the literal `conditional_offer_secret`.
- [ ] AC2: A token signed with one key fails verification under another key.
- [ ] AC3 failure path: staging and production startup refuse a missing or short key.
- [ ] AC4: An offer issued before a cold restore can still be accepted after it with the same configured key (assistant enabled, cold restore before every event, per `test/assistant-cold-journey.test.ts`).
- [ ] AC5: The built staging descriptor lists the new secret binding and no value.

## ADRs to read

0086 (token digests, single use), 0075 (no secrets in logs), 0095 (Cloudflare hosting), 0106 (cold restore).

## Comments
