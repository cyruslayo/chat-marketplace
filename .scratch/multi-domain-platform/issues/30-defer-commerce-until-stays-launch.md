# Record the decision to defer commerce until after the stays launch

Status: ready-for-agent
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
