# Secure and minimize agent-interaction data

Every interaction stream is bound server-side to an authenticated principal, tenant, session and authorization context; client-supplied ownership claims and opaque identifiers confer no access. Guest, operator, connector, tool and model content is untrusted data. A2UI renderers accept validated typed properties only, use strict browser security controls, allow-listed destinations and secure upload/payment contexts, and never execute agent content.

Public, account, booking-sensitive, identity, payment, access and secret data receive explicit projection rules. Restricted identity and payment material, secrets, raw scores and premature access information never enter general interaction state or logs. Precise location and access should normally use authorized secure references. The proposed 30-day transient, 180-day conversational/telemetry and seven-year material audit periods remain provisional pending the DPIA, Nigerian privacy review and final record-retention mapping.

### Amendment (18 Oct 2026, recorded 25 Oct 2026): commerce payment reference keys

The commerce domain (ADR 0100, parked by ADR 0104 decision 5) stores payment references as a keyed HMAC, not as the raw reference. The key pair is:

- `COMMERCE_REFERENCE_HMAC_KEY`: the secret. The commerce migration runbook requires at least 32 bytes.
- `COMMERCE_REFERENCE_HMAC_KEY_ID`: a plain identifier such as `k1`. It is stored in clear with each hash, so it must hold no secret.

The pair is required only when commerce is enabled, that is `COMMERCE_ENABLED=true` (ADR 0104 decision 5). When commerce is off, the pair is not required and is not read. The Cloudflare configuration will stop requiring the secret by default.

A test-only key is available only to the local guest, and only when both `NODE_ENV=test` and the explicit opt-in `COMMERCE_REFERENCE_TEST_KEY=allow` are set. It is never a fallback outside the test runner.

No secret value appears in logs or errors. A missing or short key fails closed, and its error names the variable, never its value.
