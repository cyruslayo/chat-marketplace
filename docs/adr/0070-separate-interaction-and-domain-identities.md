# Separate interaction and domain identities

User, tenant, device, browser-session, tab, thread, run, message, surface, action and command identities remain distinct from booking-request, booking, payment, incident and ledger identities. Externally visible identifiers are opaque; a durable thread supplies conversational context but never owns domain state, and each turn or resumed execution creates a separate run.

Only one mutating run may be active per thread. Multiple tabs may observe, but material confirmations use a short server-side interaction lease and domain idempotency remains the final safeguard. Reconnect resumes by sequence or receives a compacted snapshot without creating a new run, while logout, revocation, tenant change and other authentication invalidation terminate attached streams and confirmation authority.
