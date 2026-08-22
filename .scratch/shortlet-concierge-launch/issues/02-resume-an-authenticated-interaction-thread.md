# Resume an authenticated Interaction Thread safely

Status: resolved
Type: AFK
User stories: 95–97, 102, 104, 109

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Let an authenticated principal start, interrupt, reconnect to, and observe an Interaction Thread while preserving distinct session, tab, thread, Agent Run, message, and domain identities. Restore interaction context without treating it as authoritative booking state.

## Acceptance criteria

- [x] Authentication and tenant scope are derived server-side and enforced on every thread operation.
- [x] One mutating Agent Run is allowed per thread while multiple authorized tabs may observe.
- [x] Reconnect resumes by sequence or returns a compacted Interaction Projection without silently starting a new run.
- [x] Logout, revocation, or tenant change terminates streams and invalidates material confirmation authority.

## Completion note

Issue 02 is implemented with monotonic replay and compaction sequencing,
an immutable public thread descriptor, one mutating Agent Run with
authorized observers, explicit same-tenant session rebind, exact-session
revocation, and tenant-change authority invalidation.

SecurityContext is a trusted platform contract. The consuming
authenticated server/application boundary is responsible for deriving
principal, tenant, and session identity from authenticated server state
before calling InteractionThreadManager.

Validation: 309 tests passed, 0 failed across 4 suites; Weaver vendor
verification and TypeScript checks passed.

## Blocked by

- [Issue 01](01-browse-one-eligible-unit.md)
