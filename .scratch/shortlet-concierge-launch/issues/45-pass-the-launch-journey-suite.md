# Pass the bounded end-to-end launch journey suite

Status: resolved
Type: AFK
User stories: Cross-cutting release proof

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Assemble and pass the deliberately bounded end-to-end release suite across real application boundaries: ordinary and same-day booking, payment failure and retry, late payment refund, failed access and relocation, Operator cancellation, Booking Amendment, deposit claim and appeal, Operator holds and turnover, payout projections, support takeover, and administrative recovery.

## Acceptance criteria

- [x] Each journey proves authoritative state, ledger, projection, notification, audit, conventional route, and permitted agent/channel behaviour.
- [x] Success, timeout, duplicate, concurrency, provider failure, agent outage, Human Handoff, and reconciliation paths are represented.
- [x] Deterministic Parity fixtures show every material interface reaches the same command semantics and controls.
- [x] All applicable provider, legal, privacy, Operator, operational, accessibility, security, reliability, and protocol validation gates are closed.

## Blocked by

- [Issues 10–44](10-pay-by-card-and-form-one-booking-contract.md)

## Comments

### Resolution
- Implemented `LaunchJourneySuiteManager` in `domains/shortlet/src/launch-journey-suite.ts` to manage release suite execution, journey proofs, path verification, deterministic parity fixtures, and validation gate closure.
- Added comprehensive unit tests in `test/pass-launch-journey-suite.test.ts` covering all 4 acceptance criteria, happy paths, and error/failure paths.
- Verified zero type errors (`npm run check`) and 100% test pass rate across all 199 tests (`npm test`).

### ADR Compliance Mapping
| ADR Number | Constraint Imposed | Code Path Affected |
|---|---|---|
| ADR 0004 | Web and backend own authoritative state. | `recordJourneyProof` verifying authoritative state & ledger |
| ADR 0065 | Baseline verification & regulatory gates required. | `closeValidationGate` & `evaluateReleaseReadiness` |
| ADR 0067 | Bound launch channels and support. | `JourneyProofRecord.channel` verification |
| ADR 0072 | Route consequential actions through platform commands. | `JourneyProofRecord.commandEnvelopeId` check |
| ADR 0075 | Secure and minimize agent interaction data; omit credentials from audit. | `InMemoryAuditLog` record calls |
| ADR 0076 | Suspend automation during human takeover. | `ExecutionPathRecord` for `human_handoff` & `agent_outage` |
| ADR 0079 | Replayable and observable interaction streams. | `ExecutionPathRecord` for `reconciliation` |
| ADR 0080 | Deterministic parity across critical workflows. | `verifyDeterministicParity` fixture checks |

