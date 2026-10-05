---
status: accepted
---

# Host the pilot on Cloudflare

Renumbered from 0092 to 0095 on 5 October 2026 when reconciling with `main`: ADR 0092 already records Extended Stays, and ADRs 0093/0094 record Guest Accounts and Identity Assurance. This changes the identifier only; the accepted hosting decision and its open data-protection gates are unchanged.

## Context

The Shortlet pilot currently runs as a Node application backed by SQLite. Its authoritative domain stores use synchronous SQLite operations, including atomic read-then-write transactions for inventory and payment state. Durable Objects provide synchronous SQLite-backed storage and `transactionSync`; D1 is asynchronous and would require an asynchronous rewrite across the existing domain/application boundary.

The pilot also stores manual-transfer receipt evidence and must retain exportable operational records. Cloudflare has no Nigerian data-residency option. A Durable Object location hint is best-effort placement guidance, not a residency guarantee. Cloudflare and Google Gemini therefore change the hosting, vendor and cross-border data-protection posture governed by ADRs 0065 and 0075.

## Decision

Host the Cloudflare deployment as one SQLite-backed Durable Object per tenant. The Durable Object is the authoritative system of record for that tenant's booking, payment, operator and interaction state. The front-door Worker and browser are not authorities for transaction state (ADR 0004).

Use Durable Object SQL rather than D1 so existing synchronous store operations and atomic transactions can be retained behind the `SqlDatabase` port. Transaction callbacks remain synchronous and must not span network I/O.

Store receipt evidence and scheduled exports in private R2 buckets. Receipt access remains restricted to the existing authorized back-office flow; object keys are opaque and receipts are never public. Existing receipt-specific retention and deletion rules in ADR 0090 continue to apply. Export retention remains an open launch decision under issue 12a.

Configure the Durable Object with `locationHint: "afr"` as best-effort placement guidance only. Do not claim Nigerian residency or guarantee a processing region. If scale later requires sharding by tenant, record the partitioning and transaction consequences in a separate ADR; this decision makes no cross-shard transaction guarantee.

## Data-protection conditions

The user accepted this hosting architecture on 4 October 2026, subject to the following separate launch gates:

- Treat Cloudflare (Workers, Durable Objects, R2 and Logs) and Google Gemini as assumed/proposed processors for the data each handles until Nigerian counsel and vendor contracts confirm their roles, subprocessors and terms.
- Do not process production or real-person staging data until counsel approves the cross-border transfer basis, safeguards, destinations and applicable DPIA/vendor terms. Staging may use synthetic data while that gate remains open.
- ADR 0075's 30-day transient, 180-day conversation/telemetry and seven-year material-audit periods remain provisional. Approve a data-class schedule, Cloudflare Logs retention and R2 export retention before real-data launch.
- Keep restricted identity, payment credentials, secrets and premature access data out of ordinary interaction state and logs, as required by ADR 0075.

## Consequences

- The Node adapter remains available for local development and tests; the Durable Object adapter maps the same `SqlDatabase` contract to `ctx.storage.sql` and `transactionSync`.
- ADR 0004's backend-authority rule is realized by the per-tenant Durable Object.
- ADR 0065 remains a launch gate for processor roles, cross-border transfer and approved retention. These open items block issue 15 from using real-person data.
- ADR 0075's minimization, restricted-data and logging requirements apply to Worker, Durable Object, R2 and Gemini data flows.
- ADR 0090's authorized receipt handling and 90-day deletion schedule remain unchanged; R2 is only the private evidence store, not an access path.
- The hosting decision does not itself establish lawful transfer, contract adequacy, or an approved retention schedule.
