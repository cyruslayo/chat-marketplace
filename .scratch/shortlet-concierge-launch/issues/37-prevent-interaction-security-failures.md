# Prevent cross-tenant and sensitive-data interaction failures

Status: ready-for-agent
Type: AFK
User stories: 97, 102, 109

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Apply tenant and actor authorization, confirmation-token binding, data classification, redaction, strict rendering, secure session controls, protected location/access release, and injection resistance across one complete booking interaction and its logs, uploads, tools, and surfaces.

## Acceptance criteria

- [ ] Cross-tenant IDs, stale or replayed tokens, revoked sessions, CSRF attempts, and unauthorized protected-data requests fail closed.
- [ ] Prompt, tool, listing, upload, and malicious A2UI content remain untrusted data and cannot create authority or executable UI.
- [ ] Logs, traces, analytics, errors, and model context exclude restricted identity, payment, access, secrets, and raw reasoning.
- [ ] Browser security, URL allow-lists, safe uploads, typed rendering, and provider signature checks have adversarial coverage.

## Blocked by

- [Issue 02](02-resume-an-authenticated-interaction-thread.md)
- [Issue 03](03-render-and-expire-the-first-generative-surface.md)
- [Issue 10](10-pay-by-card-and-form-one-booking-contract.md)
- [Issue 13](13-present-contract-and-release-arrival-data.md)
