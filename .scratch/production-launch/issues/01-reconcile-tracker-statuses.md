# Reconcile issue statuses with main and regenerate the work map

Status: ready-for-agent
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
