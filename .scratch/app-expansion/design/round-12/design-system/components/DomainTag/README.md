A domain tag says which domain a row belongs to, with the Agent Mark and the mode's name. It is used only where rows from two or more domains share a list.

**Maps to:** `.ui-domain-tag` (new; `.ui-domain-chip` in code).

## Anatomy
1. Agent Mark, 18px, decorative.
2. Mode name in text.

## Variants
Stays, Events, Services, Community, set by `data-mode`.

## States
| State | What changes |
| --- | --- |
| Idle | `ink-secondary` text, mark in `--mode-accent`. |
| Muted row | Unchanged; the row itself is muted. |
| Hover, focus, busy, success, invalid, disabled, stale | Not applicable: it is not a control. |

## Tokens
`ink-secondary`, `--mode-accent`, `canvas` (the mark's face). Type: small 14/20.

## Accessibility
- Plain text, read before the row's title. Not a link and not a target.

## Rules
- Not used while Stays is the only domain.
- Never a filled pill, so it is not mistaken for a status or an action.
