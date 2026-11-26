The concierge chooser lets a guest pick which concierge they are talking to, as a strip on an empty conversation and as a dialog from the mode label. It appears only with two or more registered domains.

**Maps to:** `.ui-chooser` with `__options`, `__option`, `__text`, `__line`; `.ui-chooser--dialog` inside `.ui-dialog`; `.ui-mode-label--control`; `.ui-agent-mark`. In code: `.mode-choices` and `.ui-vertical-starter.mode-choice`.

## Anatomy
**Strip**
1. `<fieldset>` with the legend "Choose your concierge".
2. One option per registered domain: a hidden native radio, the Agent Mark, the mode name.

**Dialog**
1. Native `<dialog>`, title "Choose your concierge", Close.
2. One row per domain: mark, "Concierge · Stays", its tagline or its open item, and a "Current" tag.
3. "Change concierge" (primary) and "Close".

**Mode label control**
The App bar's mode label becomes a button with the mark, the name and a chevron. Below 416px the word "Concierge" is hidden visually and kept in its name.

## Variants
Two, three or four domains. Below 416px the strip is two columns; above it, one row.

## States
| State | What changes |
| --- | --- |
| Idle | `surface`, 1px `border`. |
| Hover | `surface-subtle`. |
| Focus | 3px `focus` ring on the option. |
| Selected | 2px `--mode-accent` edge, `--mode-subtle` fill, weight 700, and the radio is checked. |
| Current (dialog) | A "Current" tag. "Change concierge" is disabled until another one is picked. |
| Open step | The line "Changing concierge now cancels the step waiting for your answer." above the buttons. |
| Busy | "Change concierge" is `aria-busy`; the dialog stays open until the server answers. |
| Failed | A Banner inside the dialog. The concierge has not changed. |
| Disabled | A domain that is off: `ink-secondary` and a disabled radio. |
| Success | The dialog closes; the conversation shows a Switch divider. |
| Stale | Not applicable; the server decides the mode (ADR 0107). |

## Tokens
`surface`, `surface-subtle`, `canvas`, `border`, `ink`, `ink-secondary`, `indigo-deep` (backdrop, at 60% opacity), `focus`, `--mode-accent`, `--mode-subtle`, `radius-md`, `radius-xl`, `space-2`, `space-4`. Type: 14/20 600; dialog title h2.

## Accessibility
- Strip: a radio group named by its legend. Arrow keys move, Space selects.
- Dialog: `<dialog>` opened with `showModal()`, so focus is kept inside and Escape closes it. Focus starts on the checked radio and returns to the mode label.
- Control: a button named "Concierge, Stays. Change concierge".
- Targets: strip options are at least 52px tall; dialog rows at least 64px.
- Modes differ by name and silhouette as well as colour.

## Rules
- Never shown with one domain. Never a tab.
- The client never sets the mode; it asks the server.

## Note on the marks
The Agent Marks use the 64-unit rig from the agent-modes playground: house, ticket and bubble are its outlines, in the still form. The Services key tag is still the Modes page's proposal.
