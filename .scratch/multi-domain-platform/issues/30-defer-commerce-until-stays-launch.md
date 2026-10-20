# Record the decision to defer commerce until after the stays launch

Status: resolved
Type: task
Blocked by: none
Requested: 20 Oct 2026
Unlocks: 31
Lane: D: Commerce
PRD: `../PRD.md`

## Why

Owner decision, 20 Oct 2026: **launch stays only, and keep commerce off in every public deployment until the commerce fixes are done.** PRD `:166` left the first-vertical choice to the owner, and this records it.

Why commerce is not ready for guests (evidence in issue 31 and `../screenshots/31/`):
- checkout cannot take payment: slice 22 is `ready-for-agent` and blocked by slice 04, which is `needs-info`;
- the task rail and starters (slice 26) are implemented but still `claimed`, with resolution deferred;
- a commerce-on walk on 20 Oct 2026 found four blocking chat UX defects (issue 31);
- the Worker has no public route to the CommerceMarket object (`apps/cloudflare/src/worker.ts:48` sends non-platform paths to SHORTLET), and the Shortlet object composes commerce `disabled` (`apps/cloudflare/src/shortlet-pilot-do.ts:295`).

## What to do (documentation only, no code)

1. In `../map.md`, add a "Deferred until after the stays launch" note under Lanes. It lists slices 04, 22, 26, 29 and the new 31 as parked, with this issue as the reason. Add rows for 30 and 31 to the slice table.
2. Append a dated `## Comments` entry to issues 04, 22, 26 and 29 that points to this issue. Do not change their status: the work is parked, not cancelled.
3. Draft an ADR in `docs/adr/` (next number) titled along the lines of "Launch stays first; keep commerce off in public deployments". It covers: the decision, the conditions for turning commerce on (slice 04 accepted, 22 resolved, 26 resolved, 31 blocker items fixed, and a public Worker route to CommerceMarket), and the fact that the local demo (`apps/local-guest/src/cli-start.ts`) may keep commerce on for development. Mark it `proposed`: only the owner accepts ADRs (map, "Workflow").
4. In `../../pilot-launch-readiness/map.md`, point to `../pilot-launch-readiness/issues/27-disable-commerce-on-node-pilot-hosts.md` as the code half of this decision.

## Acceptance criteria

1. The map shows which slices are deferred and why, and links this issue
2. Each parked slice has a dated comment pointing to this issue, and its status is unchanged
3. A proposed ADR records the decision and the conditions for turning commerce on
4. The pilot launch readiness map links its code issue for keeping commerce off

## Comments

### Implementation plan — 20 Oct 2026

Owner requested direct work, not subagents. Branch `mdp/30-defer-commerce` starts at `main` (`ad5ad72`) in `.scratch/worktrees/mdp-30-defer-commerce`. Scope is documentation only: this issue, the two maps, comments on issues 04/22/26/29, and proposed ADR 0104. Parked statuses stay unchanged. The owner, not this task, accepts the new ADR; recording the owner's launch decision does not accept that draft.

| ADR | Constraint | Acceptance criterion / document |
| --- | --- | --- |
| 0002 | Commerce payments require renewed provider/legal confirmation; historical policy is not launch authorization. | AC3: slice 04 must be accepted before commerce can launch. |
| 0003 | Shortlet is the first reference domain; commerce may remain internal. | AC1–3: park, do not delete or cancel commerce. |
| 0004 | Backend remains authoritative. | AC3: no change to conversation or transaction authority. |
| 0067 | Shortlet launch channels remain bounded. | AC3: no new public commerce or ChatGPT channel is authorized. |
| 0074 | Stale surfaces must fail closed and preserve committed work. | AC1–3: issue 31's blocking UX items must be fixed before reopening. |
| 0075 | Preserve minimization and restricted-data rules. | AC2–3: links to existing synthetic evidence, no credentials or new disclosures. |
| 0095 | Hosting and real-data protection gates remain in force. | AC3–4: Node code half is issue 27; no deployment or hosting policy changes. |
| 0099 | Hosts compose packs through the existing interface. | AC3: keep the development demo and internal commerce implementation. |
| 0100 | Commerce remains an active, separate domain; its front doors are not an unconditional launch mandate. | AC1–3: ADR 0104 proposes deferring public availability, not reversing the domain decision. |
| 0101 | CommerceMarket remains separate from ShortletPilot. | AC3: a tested public Worker route is a prerequisite, not implemented here. |

Test-first verification uses four named `node:test` checks in `.scratch/stays-launch/verify-30.test.mjs` (outside product code), covering the map links/list, all unchanged parked statuses and dated comments, proposed ADR and every reopening condition, and the pilot code-half link. Run red, then edit only documentation, then green and read-only diff/ADR review. Do not resolve before verification and a commit. No independent agent review is claimed.

### Documentation verification — 20 Oct 2026

Four dedicated `node:test` checks went red (`d37c3c99-1896-44f8-b5d4-7c1009a4a4fd`, exit 1) and then green (`c35beb58-218b-4699-896c-311e9dc0e999`, 4 passed / 0 failed, exit 0). Records are in the session root `.scratch/test-runs/<id>/{run.json,output.log}`. The external scratch verification script is not product code or part of this documentation-only diff. Its new AC2 check was corrected to anchor the actual `## Comments` heading rather than an inline mention; no existing test expectation changed.

Read-only self-review: all four acceptance criteria are reflected in the docs; parked status lines are unchanged (04 `needs-info`, 22 `ready-for-agent`, 26 `claimed`, 29 `ready-for-agent`, 31 `needs-triage`); dated comments preserve history. The proposed ADR names every reopening gate and the local-demo exception, changes no accepted ADR and authorizes no deployment. Rechecked every constraint in the ADR table above against the diff. Only Markdown files will be committed. No issue 31 implementation was started. Runtime verification completed as below; commit/closeout remain pending owner approval of the specific environment exception. This issue stays claimed.

### Runtime gate and Definition of Done — 20 Oct 2026

All new records are under the session root `.scratch/test-runs/<id>/{run.json,output.log}`. Runtime source in this branch is unchanged from its `ad5ad72` main baseline. A worktree-local dependency junction reuses the installed packages without a new install or lockfile change. Tests ran only in this worktree; the session root and other worktrees were not used as browser test targets.

- Build before browser tests: `288b0219-a1ad-48ce-853a-372d13e524b3`, exit 0.
- `npm run check`: `f9aa9ba3-52fb-4aa2-a058-0e31f47471df`, exit 0.
- Dedicated four acceptance checks repeated against the completed docs: `7ea8a92c-e01c-4013-99ac-5d354bc3f4bc`, 4 passed / 0 failed, exit 0.
- Full suite once, with four concurrent non-browser files and serial browser files: `4c8f17fc-83bb-4062-9b4b-57502cd042c4`, exit 1. Phase 1: **1,980 passed / 0 failed**. Phase 2: **33/34 files passed**, 138 test passes / 2 skipped; one file timed out. `mobile-guest-journey-chromium.test.ts` AC22 failed during cleanup because its owned Chrome process did not exit within 5 seconds; the retained browser lock then caused AC23/24 lock-wait failures before the file's 900-second outer timeout. These are environment/cleanup failures, not failed product assertions.
- Workers, after the full suite ended: `8e51e339-4fed-4cb3-9779-199754e140ed`, **23 files / 159 tests passed**, exit 0.
- Only failing file rerun once alone after Workers: `7754f8d4-458b-49fa-b0af-0c353a469723`, **43 passed / 0 failed**, exit 0 (336 seconds). Under the owner's brief, classify this as environment/browser cleanup and lock contention. No second full suite was run; no test expectation or browser harness changed.
- The worktree's full suite/build rewrote **24 tracked PNGs and five generated outputs** outside issue scope. Exact worktree-relative paths are in the session root `.scratch/stays-launch/30-side-effects.md`; none is staged or restored. Owner permission is required before restoration. The root `HANDOFF.md` remains untouched.

DoD self-check:
1. Dedicated mirrored `test()` for every AC: yes, four documentation checks.
2. Failure paths: yes, checks reject absent/missing links, missing deferral/comments, changed parked statuses, missing reopening gates and an accepted rather than proposed ADR.
3. ADR discovery/read/table and post-review: yes, all table constraints rechecked.
4. No unused dependency: yes; no implementation dependencies added.
5. No invented policy: yes; records the 20 Oct owner decision and issue-specified reopening conditions without approving payments, commission or photography.
6. No bearer credentials/restricted identity in audit/logs: yes; docs link synthetic evidence only and add no logging.
7. Check clean; one full-suite environment/browser-cleanup failure, isolated file 43/43 passed, Workers 159/159 passed. **Owner exception granted:** after a report requested this specific issue-30 exception, restoration of the 29 listed verification side effects, and commit/merge of the docs-only branch to local `main` with ADR 0104 still proposed, the owner replied **"accept all"**. This approves those three actions only, not a push, deployment, future gate exception, or ADR acceptance. Exactly the 24 PNGs and five generated outputs were restored in this worktree; the intended Markdown changes and inherited root files were preserved. Documentation committed as `0ebeea9` before resolution; ADR 0104 remains `proposed`.

## Answer

Committed in `0ebeea9` on `mdp/30-defer-commerce`: the map parks 04/22/26/29/31 with a reason and issue link; 04/22/26/29 have dated comments with unchanged statuses; proposed ADR 0104 names the owner-reopening, payment-ADR, checkout, task-rail, blocker-fix and Worker-route gates plus the local-demo exception; pilot readiness links code issue 27. Eight Markdown paths only. No product code, existing test expectation, accepted ADR, or parked status changed.

Four documentation checks passed; build/check passed; 1,980 non-browser tests and 159 Workers tests passed. One full-suite browser file had a Chrome cleanup/lock timeout and passed 43/43 alone. The owner explicitly accepted that issue-specific exception, restoration of the 29 verification side effects, and local main integration while the ADR stays proposed. All seven DoD checks and complete run IDs are above. Direct self-review only, per the owner's instruction; no independent reviewer claim. No push or deployment; issue 31 remains parked and unstarted.
