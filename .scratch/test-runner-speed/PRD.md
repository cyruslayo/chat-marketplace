# Faster test feedback and reliable run records

Status: claimed
Requested: 7 Oct 2026

## Goal

Provide selected test runs, complete sanitized results, measured concurrency settings, and a full-suite gate for coordinated waves.

The user approved one full-suite gate per wave. Browser reuse and fixture lifecycle changes remain outside this effort.

## Interfaces

- Keep `npm test` as the complete two-phase suite.
- Add `test:non-browser`, `test:browser`, and `test:files` npm commands.
- Support suite selection, repeated `--file`, `--list`, non-browser `--workers`, and `--test-name-pattern`.
- Reject invalid selections and concurrency overrides before execution.
- Keep browser files sequential and preserve the existing complete discovery set.

## Run records

Assign each run a unique identifier. Record selected files, sanitized command metadata, ownership, monotonic durations, counts, source locations, exit codes, and state.

Retain complete failure metadata despite long output. Exclude secrets, payloads, page contents, and unrestricted error objects.

Mark interrupted runs incomplete. Never report an interrupted or failed run as passing.

## Verification and benchmark

Use controlled fixtures for runner tests. Preserve existing application assertions, browser isolation, and timeouts.

Benchmark one fixed CPU, SQLite, HTTP, and Weaver selection twice with each configuration: current default, 2, 4, and 8 workers.

Choose the fastest zero-failure median. Prefer fewer workers for equal times. Retain the existing setting without reliable improvement.

Verify the selected setting in the final full run. Report existing application failures separately from runner failures.

## Workflow

Run targeted checks, type checking, and required builds per issue. Commit implementation before resolution.

Keep wave issues claimed until integrated verification passes. Require a full suite for standalone issues.

Invalidate wave verification after relevant code changes. Do not use automatic full-suite retries for diagnosis.

## ADR constraints

| ADR | Constraint | Acceptance coverage |
| --- | --- | --- |
| 0075 | Exclude secrets and restricted data from reports. | Sanitization and synthetic-secret tests. |
| 0078 | Preserve accessibility and browser coverage. | Discovery parity and sequential browser execution. |
| 0079 / 0069 | Preserve replay and accurate upgrade verification. | Full-suite gate, failure and interruption records. |
| 0081 | Preserve Weaver boundaries and parity checks. | Complete discovery includes Weaver tests. |

## Ownership

Worker A owns runner execution, CLI configuration, package scripts, and workflow documentation.

Worker B owns reporter modules, controlled tests, verification records, and all benchmark/test execution.

The orchestrator owns integration, independent review, scoped commits, and final completion decisions.

Preserve all earlier Weaver changes and unrelated working-tree changes.
