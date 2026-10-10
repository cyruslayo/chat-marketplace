# Selected runs, reliable records, and measured concurrency

Status: claimed
Type: task
Blocked by: none

## What to build

Implement the interfaces, records, benchmarks, and approved wave workflow in `../PRD.md`.

## Acceptance criteria

- AC1: The complete selection equals the current runner's discovery set, with every browser file classified correctly.
- AC2: Suite, repeated file, list-only, and named-test selection run exactly the intended tests.
- AC3: Missing files, empty selections, invalid workers, and conflicting concurrency arguments fail before test execution.
- AC4: Non-browser worker limits apply correctly, and browser execution remains sequential.
- AC5: Successful, failed, skipped, and cancelled runs record complete counts, durations, exit codes, and final state.
- AC6: Every run has a unique identifier, sanitized command metadata, selected files, and owned-process metadata.
- AC7: Long output preserves failure names, codes, and source locations without storing synthetic secrets or raw payloads.
- AC8: Interrupted execution stops only owned work and never reports a passing result.
- AC9: Fixed-selection benchmarks compare the default and 2, 4, and 8 workers twice, with measured winner selection and tie behavior.
- AC10: Project instructions require targeted checks per issue and integrated full verification before resolving coordinated waves.

## Verification

Write failing controlled tests for each criterion before implementation.

Run targeted tests and type checking before benchmarking. Freeze edits during performance measurements and final verification.

Review the implementation independently before the final full-suite run.

Report application failures separately. Do not weaken assertions or resolve this issue with a failed full gate.

## Answer

Pending verification.
