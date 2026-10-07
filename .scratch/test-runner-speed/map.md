# Test runner speed effort

PRD: `PRD.md`

| Wave | Issue | Gate |
| --- | --- | --- |
| 1 | 01: selected runs, safe records, profiling, and wave workflow | Targeted tests, type check, benchmark, independent review, full verification. |

Use two GPT-6 Luna high workers with separate file ownership.

Use GPT-6 Luna high for every subagent, including independent reviewers, until the user changes this instruction.

## Current state

- Baseline HEAD: `4351555a46b0fe85b573384539466f0d48c87568`.
- Earlier Weaver work remains uncommitted and outside this effort.
- Initial process inspection found no active Node test workers.
- Earlier browser diagnostic recorded 164 passes, one gallery-count failure, and one skip.
- Do not resolve this effort unless the required verification gate passes.

## Context pointers

Append verified results and commit references here.
