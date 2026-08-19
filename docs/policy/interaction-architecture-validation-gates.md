# Interaction Architecture Validation Gates

ADR-0068 through ADR-0080 close the launch interaction-architecture decisions. The following are execution gates rather than open product decisions.

1. **Protocol-profile lock** — commit exact AG-UI and A2UI schemas, dependencies, integrity hashes and event allow-lists; disable draft features.
2. **Weaver integration and framework-independence proof** — replay the same A2UI interactions through Weaver and a framework-independent harness, producing identical platform commands and domain results with no Weaver types in authoritative packages; verify that client reconnect may use Weaver transport facilities while durable replay across server restarts remains host-owned.
3. **Catalogue certification** — validate schemas, semantics, accessibility, security, unsupported-version fallback and stale-surface rejection for every launch catalogue.
4. **Identity and concurrency** — test revocation, tenant isolation, reconnect, replay, simultaneous tabs and competing mutating runs.
5. **Security and privacy** — complete threat modelling and DPIA, verify redaction and injection resistance, test protected-location and access release, and approve retention periods.
6. **Human handoff** — simulate stopping generation and tools, takeover around committed commands, automation suspension, handback and context minimization.
7. **Cross-channel parity** — certify canonical quote, request, payment, confirmation, cancellation, relocation and refund artifacts across permitted web, WhatsApp and Instagram paths.
8. **Reliability and accessibility** — test load, reconnect, duplicates, gaps, backpressure, instrumentation, keyboard and screen readers, reduced motion, small screens, poor networks and conventional operation during agent outage.

Numeric transport limits, run timeouts, service objectives and interaction-data retention periods remain provisional until their applicable gates close.
