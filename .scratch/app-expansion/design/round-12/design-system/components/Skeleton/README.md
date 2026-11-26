A skeleton holds the final layout's space while a known shape loads, with no shimmer, and always beside a line that names what is loading.

**Maps to:** `.ui-skeleton` with `--title`, `--card` and `--receipt` (shipped: `.ui-skeleton`).

## Anatomy
1. Status line, visible: "Loading this transfer…", inside `role="status"`.
2. Blocks in the exact geometry of the content they replace: a title line, fact lines, cards, a receipt frame.

## Variants
Line (16px), Title (28px, 60% wide), Card (120px), Receipt (3:4 frame).

## States
| State | What changes |
| --- | --- |
| Idle (loading) | Static `surface-subtle` blocks. No animation, so there is no movement and no layout shift. |
| Hover, focus, busy, disabled | Not interactive. |
| Success | Replaced by the content in the same place. |
| Invalid | Not applicable. |
| Stale | Not applicable: a failure becomes the error banner. |

## Tokens
`surface-subtle`, `radius-sm`, `radius-md`, `radius-lg`.

## Accessibility
- The status line is the accessible text. The blocks are decorative (`aria-hidden="true"` when they are not inside the status element).
- Use a skeleton only where the final geometry is known. For a short wait, the line alone is enough.

## Rules
- Text and critical facts load before media (value 4, Light).
