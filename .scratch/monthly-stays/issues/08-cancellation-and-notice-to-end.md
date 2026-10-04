# Cancellation and Notice to End for Extended Stays

Status: ready-for-agent
Type: task
Blocked by: 06

## What to build

- Add the **Extended** entry to the versioned cancellation catalogue (ADR 0092: 100% of the first period's Cancellation Base at T-30d, 50% at T-14d; thresholds [counsel]). Snapshot it when the Booking Request begins and again in the Booking Contract (ADR 0014). Short Stay entries are unchanged.
- **Before check-in.** `cancellation-noshow.ts` calculates the refund by component on the first period's Cancellation Base, using those thresholds measured from the Contractual Check-In Window start. Later periods that have not been paid are cancelled with nothing charged.
- **After check-in.** The Primary Guest can give a **Notice to End** (ADR 0092: 14 days, [counsel]).
  - The deterministic service computes:
    - the new last night;
    - the amount still owed through the end of the notice;
    - which paid nights after it are refunded at nightly contracted value.
  - A Booking Amendment records the new checkout (ADR 0060).
- Operator, platform and safety failures keep overriding the catalogue (ADRs 0014, 0061).
- The agent may explain the result but never compute or change it.

## Acceptance criteria

- AC1: An Extended Stay cancelled before check-in is refunded exactly per the Extended entry at each threshold, and no later period is ever charged.
- AC2: The Extended entry is snapshotted at request start, and a later catalogue change does not affect an existing request or contract.
- AC3: A Notice to End sets the last night to the night before the date 14 days after the notice, charges nothing past it, and refunds paid nights after it at their nightly contracted values.
- AC4: A Notice to End whose boundary falls in an unpaid period requires that period's Period Payment only up to the boundary.
- AC5: A Notice to End is recorded as a versioned Booking Amendment and leaves the original contract valid until the amendment commits.
- AC6: An operator- or safety-caused departure is handled under ADR 0061, not the Notice to End rule.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0092 | Extended catalogue entry; Notice to End |
| 0014, 0058 | Versioned catalogue, deterministic refunds, overrides; legally approved |
| 0060 | Versioned amendments, atomic |
| 0061 | Failure-caused departure remedies |

## Definition of Done

See `docs/agents/issue-tracker.md`.

## Comments
