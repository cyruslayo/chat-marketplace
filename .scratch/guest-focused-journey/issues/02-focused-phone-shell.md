# 02 Focused phone shell

Status: ready-for-agent
Type: task
Blocked by: 01

## What to build

On phones, a current booking task fills the available view with one scroll owner, contextual Back, compact current-stage label, and one primary action. “Ask Shortlet” opens chat while preserving the message draft and task scroll. Browser Back and visible Back agree. Desktop retains the existing split. Update the guest kit direction for approved app-bar and rail changes.

## Acceptance criteria

- AC1: A focused task on a 320 or 390-pixel phone shows one task scroll area, visible status, and current action without a persistent composer or obstructed content.
- AC2: Ask Shortlet and return preserve an unsent draft, the task state and scroll position, and predictable keyboard focus.
- AC3: Browser Back, visible Back, reopen, and cold restore return to the same safe current task; stale or unknown surfaces cannot regain an enabled action.
- AC4: Desktop keeps the conversation and workspace split, and conventional routes retain the same facts and actions.

## ADR map

0074: stale surface lifecycle fails closed. 0077: channel facts stay canonical. 0078: 320px, focus, targets, reduced motion and keyboard. 0080: conventional parity. 0106: cold restore and stable ids. Read other intersecting ADRs before code.

## Tests and evidence

Write one named failing test per AC. Cover open/close, Back, restore, draft, focus, and scroll. Run `npm run check` and affected tests. Run one changed real-Chrome file at a time. Capture 320/390/768/1280, light/dark, and check target size and overflow. Record exact commands and counts in Comments and complete the Definition of Done.

## Comments
