# Resume an authenticated Interaction Thread safely

Status: ready-for-agent
Type: AFK
User stories: 95–97, 102, 104, 109

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Let an authenticated principal start, interrupt, reconnect to, and observe an Interaction Thread while preserving distinct session, tab, thread, Agent Run, message, and domain identities. Restore interaction context without treating it as authoritative booking state.

## Acceptance criteria

- [ ] Authentication and tenant scope are derived server-side and enforced on every thread operation.
- [ ] One mutating Agent Run is allowed per thread while multiple authorized tabs may observe.
- [ ] Reconnect resumes by sequence or returns a compacted Interaction Projection without silently starting a new run.
- [ ] Logout, revocation, or tenant change terminates streams and invalidates material confirmation authority.

## Blocked by

- [Issue 01](01-browse-one-eligible-unit.md)
