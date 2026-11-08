# Sign Conditional Offer tokens with a configured secret

Status: resolved
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

### Implementation plan and ADR map (8 Nov 2026)

Read the wrapped reachability review (49), both bounded-context glossaries and the ADR directory. ADR 0086 governs **operator** one-time tokens and hash-only sessions; it does not itself prescribe Conditional Offer digest storage. The existing offer's single-use SHA-256 digest and 16-entry bound remain the current code contract; ADR 0072/0075 govern the offer confirmation credential. No raw key or token enters logs.

| ADR | Constraint | Acceptance criterion / code path |
|---|---|---|
| 0004, 0095, 0101 | Authoritative offer state lives in the Shortlet Durable Object; platform owns accounts and threads. | AC3–AC5: compose the same configured key for guest and operator on Worker and Node; don't store it in guest state. |
| 0072 | Confirmation is server-issued and checked by the application command gate. | AC2/AC4: wrong-key tokens fail; correct-key cold restore accepts through the existing command path. |
| 0075, 0086 | Keep credentials out of logs and ordinary records; hash-only one-time credential storage pattern. | AC1/AC5: no hard-coded production signing key or secret value in the descriptor; retain the offer digest-only storage contract. |
| 0106 | Pending surfaces and their ids remain valid after cold restore, while forged ids fail closed. | AC4: assistant-enabled cold-restore journey, no re-minted identity or bypass. |

Key length follows the existing 32-character `SHORTLET_GUEST_CODE_HASHING_KEY` startup guard. The app factory and manager receive the key explicitly; only local/test compositions supply an unmistakably local constant, while staging/production configuration refuses absent or short values before a runtime is assembled. The deployed descriptor declares the binding by name alone.

### Implementation evidence (8 Nov 2026)

- AC1: `test/conditional-offer-signing-secret.test.ts` scans every TypeScript/JavaScript file under the six affected production `src/` trees for the former literal; no match. Token issuance, rotation on restore and acceptance now use the injected key. Incorrect signatures and malformed hex signatures fail closed.
- AC2: the named test signs with key A, verifies with A, rejects B and a tampered signature.
- AC3: the named test checks missing and 31-character keys in **both** Node and Worker configuration loaders, in staging and production, plus a good key. Production guest/owner compositions also require an explicit key; local/test compositions explicitly use `LOCAL_ONLY_CONDITIONAL_OFFER_KEY`.
- AC4: the named assistant-enabled test uses a fresh environment and manager over the same SQLite file before **each** event at the 27 Oct 2026 clock, without seeded contact. The browser-held token accepts after restore, transitions the offer to `accepted`, and a later replay is rejected. The existing `test/conditional-offer-token-restore.test.ts` covers the digest-only persistence, forged claims and expiry paths.
- AC5: `test/cloudflare-config.test.ts` inspects the staging descriptor produced from the deploy configuration with a sentinel build variable: exactly five secret bindings in the default/OpenRouter modes, the new binding is `{type: "secret"}`, and the sentinel value is absent. This is a static descriptor check, not a Cloudflare deploy. `AGENTS.md` names all five bindings.

Exact commands (each prefixed with `C:\Program Files\Git\usr\bin\env.exe -u LLM_API_KEY`; npm invoked via `node C:\nvm4w\nodejs\node_modules\npm\bin\npm-cli.js` on Windows):

- `node --import tsx --test test/conditional-offer-signing-secret.test.ts test/cloudflare-config.test.ts test/conditional-offer-token-restore.test.ts test/guest-process-restart.test.ts test/assistant-cold-journey.test.ts test/issue-and-accept-conditional-booking-offer.test.ts test/integrate-conditional-offer-application.test.ts test/integrate-card-payment-application.test.ts test/integrate-bank-transfer-application.test.ts test/demo-mode-config.test.ts test/demo-accept-delay-config.test.ts test/pilot-production-composition.test.ts`: 88/88 pass, 0 fail.
- `npm run test:workers -- apps/cloudflare/test/cloudflare-config.spec.ts apps/cloudflare/test/pilot-worker.spec.ts`: 7/7 pass across 2 specs. The first run caught a fixture constructing a production owner without the key; it was corrected and the filtered specs rerun green.
- `npm run check`: exit 0, no TypeScript errors and Worker bundle guard clean. An earlier run found the test-only `Cloudflare.Env` declaration missing the new binding; corrected it before this passing run.

Definition of Done review: (1) AC1–AC5 have separate named tests, including the descriptor test in `test/cloudflare-config.test.ts`; (2) key mismatch, malformed signature, missing/short key and replay failure paths are asserted; (3) ADR table above was rechecked against the guest/owner composition and digest path; (4) key is injected through the existing config/manager factory, not ambient domain state; (5) 32-character minimum follows the existing guest-code precedent; (6) no secret value appears in any descriptor or log; (7) affected tests, Worker specs and type check pass. Full-suite batch gate remains issue 12. Wrapped review `shortlet-concierge-launch/49` stays `needs-triage`: its proposed token-in-interaction-projection criterion and owner triage decision go beyond this signing-key issue.

## Answer

Committed signing-key injection and fail-closed configuration as `e9f109f`. All five criteria are covered: 88/88 affected Node tests, 7/7 Worker tests, clean `npm run check`. The wrapped security review remains open for its broader projection and triage decisions.
