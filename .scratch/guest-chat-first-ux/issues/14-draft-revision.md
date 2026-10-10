# Draft revision: "make it 3 nights" before submission

Status: ready-for-agent
Type: grilling
Blocked by: 04a
Parent: [04](04-never-silent.md)

## What to build

`BookingRequestApplication` offers only `createDraft`, `disclose`, `getArtifact`, `confirm` and `decline` (`apps/web/src/booking-request-application.ts:55–99`), and `BookingRequestManager` has no way to revise a draft. `BookingAmendmentManager` works only on a paid `BookingContract`.

Before any code: write a short design note choosing between a replacement draft that supersedes the old one and a new revise capability. Map it to ADR 0015 (replacement quotes the guest may accept or decline) and ADR 0060, and ask the user to approve any new domain capability. Implementation follows as a task once this is decided.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC3: "make it 3 nights" on a draft proposes a re-quoted draft that needs confirmation.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0005 | Distinguish request, offer and reservation truthfully |
| 0060 | Changes after submission are versioned amendments |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.
