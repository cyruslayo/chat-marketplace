# Conventional /stays/search page

Status: ready-for-agent
Type: task
Blocked by: 07
Parent: [06](06-conventional-routes.md)

## What to build

Serve a server-rendered `/stays/search` using `pageShell` and `errorPage` from `apps/web/src/ui-kit.ts`, following `renderConventionalUnitDetailHtml` (`guest-server.ts:1658`). Match the route before the unit regex (:2045). Search criteria come from the query string built by `apps/web/src/presentation.ts:24–30`.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC2: `/stays/search` never reaches the unit-detail handler.
- AC1 (search part): `/stays/search` built by the guest app returns 200 with the matching results.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0080 as modified by 0081 | Material workflows have conventional route parity |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 28 Sept 2026: the audit for launch-readiness issue 10 found this work implemented and tested on main, but this file was never set to resolved. The status is left for a human to confirm against the Definition of Done.
