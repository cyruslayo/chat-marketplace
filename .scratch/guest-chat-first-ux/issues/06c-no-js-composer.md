# Composer works without JavaScript

Status: ready-for-agent
Type: task
Blocked by: 06b
Parent: [06](06-conventional-routes.md)

## What to build

Give the composer form (`guest-server.ts:1628`) a real `action` and `method`. Add a POST route that runs the turn and returns a server-rendered transcript with the conventional links from 06a and 06b.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC3: With JavaScript disabled, posting the composer produces a server-rendered reply.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0080 as modified by 0081 | Material workflows have conventional route parity |
| 0070–0072 | Routes re-authorize and version-check commands |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.
