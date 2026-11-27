# Tab bar, Ask bar, task bar and desktop rail

Status: ready-for-agent
Type: task
Blocked by: 11 (shell strings approved by the owner 27 Nov 2026: tab and side navigation labels, the badge text, the Ask bar labels including "Ask the concierge", "Close {task}" and "Help"; D10 and D13 accepted; 07, 08, 12 resolved)

## What to build

- The published components only (issue 08), in the shared kit CSS and `guest-kit.ts`, used by the chat shell and the standard pages.
- Section pages: tab bar and Ask bar. Task pages: task bar, no tab bar. 48rem and wider: the guest side navigation, with the existing conversation split kept.
- The Ask bar is a link that opens the conversation with a server-known context reference. It carries no text and no authority.
- Back, focus, safe areas and the phone keyboard: the tab bar must not cover a field or sit above the keyboard.
- With one registered domain, nothing about other domains renders.

## Acceptance criteria

- AC1: The navigation table (issue 12) has no remaining Help or list gap.
- AC2: The share of height left for content at 320×568 is measured and accepted by the owner before the rest is built (the prototype leaves about 71% at 320×640).
- AC3: Keyboard, screen reader and Android Back reach and leave every section and task.
- AC4: Closing a task sends no command.
- AC5: A forged or stale Ask context opens a plain conversation.
- AC6: With no JavaScript, tabs and tasks work as links and pages.
- AC7: Captures at four widths, two themes.

## ADR compliance

0074, 0078, 0080, 0106, 0107.

## Comments
