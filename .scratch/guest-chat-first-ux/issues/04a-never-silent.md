# Never silent: answer every message and keep the surface

Status: ready-for-agent
Type: task
Blocked by: 07, 02
Parent: [04](04-never-silent.md)

## What to build

Root cause: `#refreshWorkflow` runs before any text parsing (`guest-server.ts:224–228`) and returns `messages: []` for a pending request (:1283) and a confirmed booking (:1195). Always produce a reply for the stage the guest is in. Answer questions about the apartment from `unit.amenities` (`browse.ts:37`) via `guestAmenityLabel` (`apps/web-agent/src/guest-content.ts:12`), or say the fact isn't listed. For a submitted Booking Request, explain that it can't be changed and why. Draft changes are left to issue 14. Fix the fallback, which probably comes from re-processing the same surface id in `renderSurface` (`client.ts:474–481`). Wording comes from the 07 glossary.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC1: Every guest message gets an assistant reply in every workflow state.
- AC2: "is there parking" is answered from unit amenities, or with a statement that it isn't listed.
- AC4: "make it 3 nights" on a submitted Booking Request never changes it silently; the reply explains the amendment path or why none exists.
- AC5: A free-text turn with a live surface open does not demote that surface to the fallback.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0005 | Distinguish request, offer and reservation truthfully |
| 0060 | Changes after submission are versioned amendments |
| 0074 | Fail closed on stale surfaces, but keep safe text |
| 0075 | Guest text is untrusted |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.
