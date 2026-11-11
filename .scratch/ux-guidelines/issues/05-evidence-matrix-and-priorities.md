# 05 · Consolidate the evidence matrix and set priorities

Status: ready-for-agent
Type: task
Blocked by: 01, 02, 03, 04
Phase: 0 (Batch A)
Applicable ADRs: guideline §14; every ADR cited in the matrix rows

## What to build

Merge the rows from 01 to 04, remove duplicates, and assign P0 to P3 (§14).

- Confirm, re-scope or drop issues 12 and 20 (both blocked by this one), and any issue from 06 to 31 that the evidence contradicts.
- List any new P0 or P1 finding as a proposed issue title. Do not write the issue files until the owner approves.
- Put to the owner the open vocabulary conflict: guideline "Amount Due Now" versus `GUEST_FACT_LABELS.amountDueNow` = "Total to complete booking" (`apps/web-agent/src/guest-content.ts:426`). Never change it silently.
- Write a short summary at the top of `evidence-matrix.md`: counts by priority and by surface.

## Acceptance criteria

1. Every matrix row has a priority and either an issue number or the label "no action"
2. The decision on issues 12 and 20 (confirm, re-scope or drop) is recorded in their Comments
3. The Amount Due Now decision is asked of the owner and its answer recorded in map.md

## Rules

- Docs only. Do not commit. The orchestrator reviews the work and commits it.

## Comments
