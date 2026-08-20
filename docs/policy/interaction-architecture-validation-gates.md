# Interaction Architecture Validation Gates

The following are execution gates for the current interaction architecture rather than open product decisions.

1. **A2UI and Weaver boundary certification** — verify the supported A2UI v0.9.1 version and catalogue behaviour, deterministic Interaction Artifact to A2UI presentation, unsupported-version or catalogue failure behaviour, and no framework types in authoritative layers. Weaver is replaceable presentation infrastructure, not an owner of business rules, authority, replay, or concurrency.
2. **Platform interaction stream reliability** — verify the versioned platform-owned Interaction Stream contract, registered event allow-list, ordered replay, reconnect, duplicate and conflict handling, gap detection, payload and rate limits, and redacted telemetry. The stream contract is not a renderer or framework transport profile.
3. **Surface lifecycle and authority** — verify active, stale and expired semantics, fail-closed actions, deterministic fallback, and conventional routes from authoritative projections.
4. **Identity and concurrency** — test revocation, tenant isolation, distinct interaction and domain identities, reconnect, simultaneous tabs, leases and competing mutating runs.
5. **Security and privacy** — complete threat modelling and DPIA, verify redaction and injection resistance, test protected-location and access release, and approve retention periods.
6. **Human handoff** — simulate automation suspension, takeover around committed commands, handback and context minimization.
7. **Cross-channel parity** — certify canonical Interaction Artifacts across permitted web, WhatsApp and Instagram paths, with the same platform command semantics where actions are available.
8. **Reliability and accessibility** — test load, reconnect, duplicates, gaps, backpressure, instrumentation, keyboard and screen readers, reduced motion, small screens, poor networks and conventional operation during agent outage.

Numeric limits, run timeouts, service objectives and interaction-data retention periods remain provisional until their applicable gates close.
