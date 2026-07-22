# Prevent cross-tenant and sensitive-data interaction failures

Status: resolved
Type: AFK
User stories: 97, 102, 109

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Apply tenant and actor authorization, confirmation-token binding, data classification, redaction, strict rendering, secure session controls, protected location/access release, and injection resistance across one complete booking interaction and its logs, uploads, tools, and surfaces.

## Acceptance criteria

- [x] Cross-tenant IDs, stale or replayed tokens, revoked sessions, CSRF attempts, and unauthorized protected-data requests fail closed.
- [x] Prompt, tool, listing, upload, and malicious A2UI content remain untrusted data and cannot create authority or executable UI.
- [x] Logs, traces, analytics, errors, and model context exclude restricted identity, payment, access, secrets, and raw reasoning.
- [x] Browser security, URL allow-lists, safe uploads, typed rendering, and provider signature checks have adversarial coverage.

## Blocked by

- [Issue 02](02-resume-an-authenticated-interaction-thread.md)
- [Issue 03](03-render-and-expire-the-first-generative-surface.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 13](13-present-contract-and-release-arrival-data.md)

## Comments

Implemented in `packages/platform-core/src/interaction-security.ts` with unit tests in `test/prevent-interaction-security-failures.test.ts`.

### ADR Compliance Summary
- **ADR 0004 & ADR 0072**: Backend/Platform owns authoritative state; untrusted text or UI input cannot create authority.
- **ADR 0011**: Protected location and access instructions are released only after primary guest verification and request disclosure.
- **ADR 0068 & ADR 0074**: A2UI surface rendering is strictly typed with fail-closed lifecycles; executable script/UI injection is rejected.
- **ADR 0070**: Cross-tenant IDs, replayed/stale confirmation tokens, revoked sessions, and CSRF attempts fail closed.
- **ADR 0071 & ADR 0075**: Data classification and redaction scrub BVN, NIN, card details, door codes, bearer tokens, and raw chain of thought from state, telemetry, logs, and errors. URL allow-lists, safe file uploads, and provider signature verification enforce browser & boundary security.
