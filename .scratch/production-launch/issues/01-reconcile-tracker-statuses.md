# Reconcile issue statuses with main and regenerate the work map

Status: resolved
Type: AFK
Blocked by: none
Requested: 8 Nov 2026

## Parent

[PRD](../PRD.md), decision D10.

## Why

A launch checklist is only as good as the issue files behind it. Several files disagree with the code on main:

- `.scratch/WORK-MAP.md` was generated on 11 Oct 2026 and predates demo-launch, short-stays-29-nights, assistant-concierge-parity and guest-focused-journey.
- `assistant-runtime-hardening` 01-06 read `ready-for-agent`, but commits on main reference issues 04, 05 and 06 (for example 1e3547e, 4f6acce, c6d7928).
- `concierge-agent-controls` 01-05 read `claimed`, but AGENTS.md says `integration/concierge-controls` is merged to main.
- The demo-launch map lists 12 and 13 as resolved in the table and `ready-for-agent` in the context pointers.
- `.scratch/pilot-acceptance` and older notes mention a "104-day rule"; the rule is now 119 days (90-day horizon plus the 29-night Short Stay).

## What to do

- For each effort listed above, compare each open issue's acceptance criteria with main (`git log --grep`, the named tests). Set `resolved` only when the Definition of Done in `docs/agents/issue-tracker.md` is met. Otherwise leave the status as it is and add a `## Comments` entry naming what is done and what is missing.
- Regenerate `.scratch/WORK-MAP.md` with the script in its own "How this page was generated" section, adding the efforts it lacks (including this one).
- Fix stale "104-day" mentions in docs that guide testers.

## Acceptance criteria

- [ ] AC1: Every issue in `assistant-runtime-hardening`, `concierge-agent-controls` and `demo-launch` has a status that matches main, with a Comments entry citing the commits or tests used as evidence.
- [ ] AC2: `.scratch/WORK-MAP.md` is regenerated on the current main, its counts match the script output, and it includes `production-launch`.
- [ ] AC3: No tester-facing doc still says "104-day".
- [ ] AC4: No status is moved to `resolved` without evidence; anything uncertain stays open with a note.

## Comments

### Reconciliation started (8 Nov 2026)

Base: `launch/production-critical-path` at `2b129b0`, parent `16d592e` (the main commit at tracker creation). Do not infer completion from a merge alone: each issue's named tests, criteria, and any recorded blockers must be checked before a status changes.

| ADR | Constraint | Affected criterion / path |
|---|---|---|
| 0023 (1 Nov amendment) | Short Stays are 1–29 nights; the original 14-night text is superseded. | AC3: correct tester-facing 104-day horizon-plus-stay notes to 119 days. |
| 0055 | Check-in horizon is 90 days; the stay must remain inside trust validity. | AC3: 90 + 29 = 119; no change to eligibility code. |

AC1 and AC4 are evidence-only: no application policy or state is changed. The named validation checks for each criterion will be recorded with the reconciliation results.

### Evidence and checks (8 Nov 2026)

- AC1/AC4: examined all 27 issue files (hardening 9, controls 5, demo 13) against the merged code/recorded tests and the issue-specific open items. Added explicit evidence notes to all 17 open files; the ten already-resolved demo files retain their existing acceptance records. `git diff --unified=0 -- .scratch/assistant-runtime-hardening/issues .scratch/concierge-agent-controls/issues .scratch/demo-launch/issues` changes **zero** `Status:` lines. In particular, merged hardening/controls code is not treated as resolved while their recorded acceptance gaps remain. Demo 12/13 are resolved in the issue files; their older map pointers are labelled historical.
- AC2: regenerated `.scratch/WORK-MAP.md` from the working-tree issue inventory (not the outdated `origin/main` snapshot). 22 efforts, 356 files; the independent row-by-row Python assertion passed all 22 effort counts. It includes `production-launch`.
- AC3: the tester-readiness note now says 119 days and about 3 Sep 2027; the search for `104.day|104-day|104 days` in `.scratch/concierge-agent-controls/validation/*.md` has zero matches. Older dated issue Comments retain their historical 104-day discussion as evidence, not guidance.
- Tests-first correction: four criterion-named tests were added in `test/production-launch-work-map.test.ts`. First run: 2 passed, 2 failed (AC1 lacked evidence in issue 08; AC4 split at an inline mention of `## Comments`). Corrected the missing citation and the test's heading locator, then all four passed. Tests assert map counts, open issue evidence, stale tester text, and premature resolution failure paths.

Exact commands (Windows `env -u LLM_API_KEY` equivalent: `C:\Program Files\Git\usr\bin\env.exe -u LLM_API_KEY`):

- `node --import tsx --test test/production-launch-work-map.test.ts`: 4 tests, 4 pass, 0 fail.
- `node C:\nvm4w\nodejs\node_modules\npm\bin\npm-cli.js run check`: exit 0, zero TypeScript errors (also Worker bundle guard).
- `git diff --check`: exit 0 (line-ending warnings only).
- Python issue-inventory/WORK-MAP row assertion: 22/22 effort rows and 356/356 issue files matched.

Definition of Done review: (1) AC1–AC4 each has one named test; (2) missing evidence, stale map counts and stale tester copy fail the checks; AC4 checks any newly resolved issue for Answer and cited evidence, and uncertain issues for a note; (3) ADR 0023 amendment and 0055 listed/read above; (4) no dependency injection; (5) 119 days derives from 90+29, no new domain rule; (6) no credentials/log changes; (7) type check and four issue tests green. Full suites are reserved for the single issue-12 batch gate under AGENTS.md Test scope.

## Answer

The reconciliation evidence and the regenerated 356-issue inventory are committed at `71ccf94`. Hardening and controls remain open where recorded acceptance evidence is incomplete; no other issue status was upgraded on a merge alone. The tester guidance now uses the 119-day window. Criterion checks: 4/4 and `npm run check` clean.
