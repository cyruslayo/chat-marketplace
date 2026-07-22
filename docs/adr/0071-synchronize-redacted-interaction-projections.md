# Synchronize redacted interaction projections

AG-UI state contains a redacted interaction projection divided into server-owned facts, client-local ephemeral state and shared draft input. Frontend edits and deltas never constitute domain consent. Every snapshot and delta carries thread, run, stream-sequence and projection-version information; sequence gaps, patch failures, version conflicts, unsupported schemas and compaction boundaries trigger resynchronization and disable stale material actions.

Only committed application state may appear as booking, payment, refund, verification, payout, relocation or incident status. Identity evidence, payment credentials, secrets, internal risk material, premature access data and raw chain of thought are excluded. Stream compaction must preserve observable state, domain correlation and audit references.
