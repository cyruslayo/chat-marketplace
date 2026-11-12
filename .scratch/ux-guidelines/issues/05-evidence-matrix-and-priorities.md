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
- Record the owner decision of 12 Nov 2026 on the vocabulary conflict: the guest label stays "Total to complete booking" (`GUEST_FACT_LABELS.amountDueNow`) and carries the glossary meaning of Amount Due Now. Rows that flag the guideline wording are not a defect; do not propose a rename.
- Write a short summary at the top of `evidence-matrix.md`: counts by priority and by surface.

## Acceptance criteria

1. Every matrix row has a priority and either an issue number or the label "no action"
2. The decision on issues 12 and 20 (confirm, re-scope or drop) is recorded in their Comments
3. The Amount Due Now decision (keep "Total to complete booking", 12 Nov 2026) is applied to the matrix and noted in map.md

## Rules

- Docs only. Do not commit. The orchestrator reviews the work and commits it.

## Comments
