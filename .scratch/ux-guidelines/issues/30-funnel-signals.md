# 30 · Privacy-safe funnel signals

Status: ready-for-agent
Type: research
Blocked by: none
Phase: 5 (Batch E)
Applicable ADRs: 0075 (no identity material in logs); guideline §13 measurement plan

## What to build

- Find the existing telemetry: `assistant.control.outcome.v1`, `test/guest-transition-telemetry.test.ts`, and the Worker log events.
- Propose closed stage-id events for the §13 signals: search to detail, detail to request sent, offer to verified payment, draft correction category, stale-action recovery, and Operator response latency in aggregate.
- No raw messages, phone numbers, emails, references or tokens.

## Acceptance criteria

1. A table maps each §13 signal to an existing event or a proposed closed event
2. Every proposed field is a closed enum or a count, never free text
3. No code change is made until the owner approves the proposal

## Rules

- Research only: change no code, CSS, copy or tests. Phase 0 authorises no redesign (guideline §15).
- Synthetic data only. Never open `staging-secrets.env` or print the environment; prefix commands with `env -u LLM_API_KEY`.
- Run only one capture sweep or browser suite at a time. Delete any walkthrough log you create.
- Write matrix rows into `.scratch/ux-guidelines/evidence-matrix.md`, keeping what you saw (Observed) separate from what it means (Priority).
- Do not commit. The orchestrator reviews the work and commits it.

## Comments
