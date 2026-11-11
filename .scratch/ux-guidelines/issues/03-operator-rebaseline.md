# 03 · Operator inbox and detail re-baseline

Status: ready-for-agent
Type: research
Blocked by: none
Phase: 0 (Batch A)
Applicable ADRs: 0041, 0042 (active hours), 0078; guideline §3 (Operator), §5 Operator rows

## What to build

Re-baseline the local back office against the Operator rows in §5: inbox scan order, readable Unit and Guest context, response deadline, decision effect, and duplicate-decision prevention.

- Code: `apps/local-owner/src/local-owner-server.ts` (inbox ~214-245, detail ~339-357, forms ~253-283, legacy `renderOwnerDashboardHtml` ~1150-1190).
- Reach the screens with the helpers behind `test/back-office-request-inbox.test.ts` and `test/back-office-confirm-decline.test.ts`.
- Capture at 320, 390, 768 and 1280.
- Check whether anything still routes to the legacy dashboard.

## Acceptance criteria

1. The inbox and request detail each have matrix rows for hierarchy, deadline, decision effect and duplicate-decision behaviour
2. It is recorded whether the legacy dashboard is still reachable, and from where
3. No code, CSS or copy file is changed

## Rules

- Research only: change no code, CSS, copy or tests. Phase 0 authorises no redesign (guideline §15).
- Synthetic data only. Never open `staging-secrets.env` or print the environment; prefix commands with `env -u LLM_API_KEY`.
- Run only one capture sweep or browser suite at a time. Delete any walkthrough log you create.
- Write matrix rows into `.scratch/ux-guidelines/evidence/03-rows.md` (column header from `evidence-matrix.md`; 05 merges them), keeping what you saw (Observed) separate from what it means (Priority).
- Do not commit. The orchestrator reviews the work and commits it.

## Comments
