# Shell task rail, vertical starters, domain chips; events routed to their task

Status: claimed
Type: task
Blocked by: 13
Requested: 14 Oct 2026
Unlocks: 27
Lane: E: Concierge UX
PRD: `../PRD.md`

## Why

Users need to see and switch between flows from different domains (PRD, Chat UX model).

## What to build

Follow the guest UI rules in `AGENTS.md` (kit, tokens, captures). Add kit components: task rail (dropdown on mobile), vertical starter cards, domain chip, per-domain step header. Async events (offer received, order shipped) badge their own task. With only shortlet registered, the rail can be hidden.

## Out of scope

- Commerce-specific screens (27).

## Acceptance criteria

- AC1: The rail lists each task with its domain and status; selecting one restores its workspace.
- AC2: An event for a background task badges that task and does not change the open conversation.
- AC3: Captures at 320, 390, 768, 1280 show no horizontal overflow and targets of at least 44px (ADR 0078).
- AC4: Light and dark themes come from tokens only.

## Tests

Browser tests via `test/helpers/`; captures under `.scratch/multi-domain-platform/screenshots/26/`.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0078-meet-an-accessible-nigerian-launch-profile.md` | Accessibility. |
| `docs/adr/0081-use-weaver-as-the-web-a2ui-runtime.md` | Runtime. |
| `docs/adr/0077-project-canonical-interaction-artifacts-across-channels.md` | Same artifacts across channels. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Answer

Implemented the shell task rail on top of the slice-13 conversation-task model.

- `AssistantDomainPack` now carries `label`, `starterDescription?`, and `taskSummary(taskState)`; shortlet reuses `GUEST_JOURNEY` step names and the fake/commerce packs use PRD "Shop"/"Browse".
- `AssistantTask` now saves its own workspace (`activeSurfaces`, `supersededSurfaces`, `lastSurfaces`) and `badge`, so switching restores the workspace and opening a task clears its badge.
- `AssistantRuntime` exposes `getTaskRail`, `registeredVerticals`, and `recordTaskEvent`, and handles `platform.task.start` / `platform.task.switch` events.
- `LocalGuestApp` returns `tasks`/`verticals` on assistant-path responses and decorates assistant surfaces with `status: "active"` so the browser renders them.
- The shell/client render the rail (hidden with ≤1 task), vertical starters, domain chip and step header; the no-JS conversation page renders the rail from the same kit helpers.
- Kit CSS for the new components uses tokens only.

Tests: `test/assistant-task-rail.test.ts` (AC1, AC2) and `test/guest-task-rail-chromium.test.ts` (AC3 real-Chrome captures + AC4 token check). Captures saved under `.scratch/multi-domain-platform/screenshots/26/`; a reference mockup is at `.scratch/multi-domain-platform/design/26-task-rail.html`.

## Comments

Resolution is deferred (issue stays `claimed`) because the full `npm test` phase 1 cannot go green on this branch for pre-existing, slice-unrelated reasons, all confirmed present without touching slice-26 code:

1. `test/domain-boundary.test.ts` AC4 — a leftover concurrent-session worktree (`.delta/worktrees/2neyq0rvfgpp/chat-marketplace/…`) is picked up by the boundary scan.
2. `test/export-node-sqlite.test.ts` — the committed Node-export fixture is CRLF/LF churned on Windows.
3. `test/redact-platform-ids-detection.test.ts` (3 assertions) — the `.scratch/shortlet-concierge-launch/issues/50-…` SQL blocks are stale versus the exemption table.

Slice-26 evidence is green: `npm run check` clean; `assistant-task-rail`, `conversation-router`, `assistant-pack-registry`, `guest-shell`, `guest-retired-classes`, `guest-kit`, `guest-journey-rail`, `shortlet-ui-foundations` all pass (35 tests), and AC3 passes under `SHORTLET_TASK_RAIL_BROWSER=1` with `NODE_ENV=test`.

New user-facing copy (needs owner sign-off): task rail `aria-label` "Conversation tasks", "Current task", "Open task", "updates"; vertical starter heading "What would you like to do?" with the PRD-sourced "Stays"/"Shop" labels and descriptions.
