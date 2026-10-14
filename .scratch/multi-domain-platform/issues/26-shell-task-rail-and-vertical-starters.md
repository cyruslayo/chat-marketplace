# Shell task rail, vertical starters, domain chips; events routed to their task

Status: ready-for-agent
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

## Comments
