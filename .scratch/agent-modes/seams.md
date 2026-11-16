# Agent modes: seam index

Index for issues 03a to 03g, written 10 Nov 2026 from the code survey at `56d4364`. Read with [map](map.md) and [architecture analysis](architecture-analysis.md). ADR 0107 holds the decisions and its dated corrections.

## Release gate

All seven issues are `ready-for-agent` (released by the owner on 11 Nov 2026). ADR 0107 "Settled" (8 Nov 2026) says slices 3 to 5 wait for the owner's choice of the first real second domain (map slice 6). When the owner releases them, change each Status to `ready-for-agent`. Nothing here is started.

## Dependency graph

```
03a (neutral pack contract)
 |-- 03b (persist active task and task list)
 |    `-- 03d (per-task lanes in memory)
 |         |-- 03e (lane event rows and export)
 |         |    `-- 03h (lane read path table split)
 |         `-- 03f (tier C mode suggestion) <-- also needs 03c
 `-- 03c (mode follows the active task)
      |-- 03f (tier C mode suggestion)
      |-- 03k (mode theme colour switch)
      |-- 03l (mode switch announcement)
      `-- 03g (mode preview strip and sheet)
          |-- 03i (client lane cache and scroll memory; also needs 03d)
          `-- 03j (mode switch view transition)
```

Order: 03a, then 03b and 03c (either order), then 03d, then 03e, 03f and 03g. Edges: 03a to 03b, 03a to 03c, 03b to 03d, 03d to 03e, 03c and 03d to 03f, 03c to 03g. New issues (16 Nov 2026, `needs-triage`): 03e to 03h, 03d and 03g to 03i, 03g to 03j, 03c to 03k, 03c to 03l.

## Serial merge warning

These files are touched by more than one issue. Merge them one issue at a time, in a dedicated merge worktree, and rebase the next issue before it is gated:

- `apps/local-guest/src/shortlet-app.ts`: 03b, 03c, 03d, 03f, 03h.
- `apps/local-guest/src/assistant/assistant-runtime.ts`: 03a, 03b, 03d, 03f (removes `#route`).
- `apps/local-guest/src/client.ts`: 03c, 03d, 03g, 03i, 03j, 03k, 03l.
- `apps/local-guest/src/guest-kit.ts`: 03g (strip and sheet markup).
- `domains/shortlet/src/guest-interaction-store.ts`: 03e (lane rows DDL), 03h (lane read path).
- `apps/local-guest/src/response-mode.ts`: 03c, 03k.
- `apps/local-guest/src/guest-server.ts`: 03k (theme colour meta in the shell head). Check 03g's shell markup before merging 03k.
- `apps/web-agent/src/guest-content.ts`: 03f (suggestion copy), 03g (persona label and warning copy), 03l (switch announcement copy).
- `apps/web/src/shortlet-foundations.css`: 03c only; 03g may add none; 03j may add the mode-switch rules (its owner decision 4). Do not run a formatter on it.

## Owner decisions

| # | Decision | Needed by | Recommendation |
| --- | --- | --- | --- |
| O1 | Model history on a cold restore: empty (as today, 03d) or rebuilt from the lane's canonical facts and guest-authored text (ADR 0107 correction 2, proposed). | 03d | Empty first; rebuild later, once confirmed. |
| O2 | Where lane timelines persist across a cold restore. 03d persists them in the thread projection as an optional `lanes` field. The analysis planned a read-path table split (`guest_thread_tasks`, analysis 11.4). No issue owns that split. | 03d | Keep the blob version for the first slice; open a new issue for the split if lane count grows. |
| O3 | Per-lane timeline cap (a named constant). | 03d | Owner to set the number. |
| O4 | Thread store ownership. The `guest_threads` DDL is in `domains/shortlet/src/guest-interaction-store.ts:372`, but ADR 0101 and `PLATFORM_EXPORT_TABLES` (`apps/cloudflare/src/do-export.ts:70`) say platform. Decide before 03e step 4 is final. | 03e | Closed 16 Nov 2026 by owner decision: platform-owned. 03e puts the lane table beside `guest_threads` and in `PLATFORM_EXPORT_TABLES`; the DDL move to a platform module is a follow-up ADR 0101 issue. See 03e Comments. |
| O5 | "New conversation" starts a fresh thread (client thread switch, ADR 0079) and carries no lanes over. No per-lane reset. Closed 12 Nov 2026 by owner decision. A lane reset is raised as its own issue only if a real second domain needs it. | 03d | Closed. |
| O6 | Suggestion copy for tier C, and whether tiers A and B stay disabled. ADR 0107 decision 8 and the correction say tier C only. | 03f | Closed 16 Nov 2026 by owner decision: tiers A and B disabled; message "I can help with that as Concierge · {label}. Your stay details are saved.", chip "Switch to Concierge · {label}". See 03f Comments. |
| O7 | Test-only fixture CSS for the fake shop tokens (03c step 5): a file under `test/fixtures/`, never in the shipped stylesheet. | 03c | Approve this approach. |
| O8 | Commerce text assertions change (03f step 10) while commerce is parked (ADR 0104). | 03f | Closed 16 Nov 2026 by owner decision: approved, smallest change per file. See 03f Comments. |

## Unassigned slice 4 and 5 items

Assigned on 16 Nov 2026 as `needs-triage` issues, each released by the owner before it is built: the lane read path ([03h](issues/03h-lane-read-path-table-split.md), analysis 11.4), the client lane cache and scroll memory ([03i](issues/03i-client-lane-cache-and-scroll-memory.md), 11.5), the `mode-switch` View Transition ([03j](issues/03j-mode-switch-view-transition.md), 5.5), the theme colour switch ([03k](issues/03k-mode-theme-color-switch.md), 5.4) and the switch announcement ([03l](issues/03l-mode-switch-announcement.md), 5.5). Each issue lists its own open owner decisions near the top.

## Gaps found by the survey

- `ModePresentation` and `validateModePresentation` already exist (`apps/web-agent/src/guest-content.ts:645`, `:772`), and the mode is on every response (slice 1 landed). 03a reuses them.
- The server already writes `data-mode` on `<html>` (`apps/local-guest/src/guest-server.ts:337`). The client does not update it. 03c fixes this without renaming the attribute.
- `data-mode` is also used on `#active-workspace` for the workspace presentation. The two are different elements, so no selector clashes. 03c has a test for it.
- `#route` is a keyword match (`assistant-runtime.ts:627`) that ADR 0106 forbids as an in-scope fast path. 03f removes it.
- Tests that assert the current keyword and commerce text: `test/conversation-router.test.ts`, `test/commerce-agent-tools.test.ts:105`, `test/pilot-commerce-off.test.ts:172`. Listed in 03f.
