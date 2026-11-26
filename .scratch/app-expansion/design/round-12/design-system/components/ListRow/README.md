A list row opens one more page from a list of places: a title, an optional line, an optional value and a chevron.

**Maps to:** `.ui-list` > `li` > `.ui-list__row` with `__primary`, `__secondary`, `__aside` and `__status` (shipped). New: the chevron as a third column, `__aside--money`, `__row--static`.

## Anatomy
1. `<ul class="ui-list">`, one bordered group on `surface`.
2. The row, one `<a>`: title (`__primary`), optional line below (`__secondary`), optional value at the right (`__aside`), then the chevron icon.

## Variants
| Variant | Use |
| --- | --- |
| Link | Opens a page. Chevron. |
| Link with value | A date or a status beside the title. Money uses `__aside--money`, in Newsreader. |
| Download | The chevron becomes the download icon and the title names the file. |
| Static | A fact with no page behind it: no chevron and no link. |

Use Result row for a stay or anything with a next step and a deadline. Use Facts list for two or more facts that open nothing.

## States
| State | What changes |
| --- | --- |
| Idle | `surface`, hairline between rows. |
| Hover | `surface-subtle`. |
| Focus | 3px `focus` ring drawn inside the row, so the rounded group does not clip it. |
| Busy | The title says what is happening ("Downloading receipt…"), `aria-busy="true"`, `ink-secondary`. |
| Failed | A Banner above the list; the row returns to idle. |
| Not available yet | A static row whose line says why. Never a greyed link. |
| Success, invalid, stale | Not applicable. |

## Tokens
`surface`, `surface-subtle`, `border-subtle`, `ink`, `ink-secondary`, `focus`, `radius-lg`, `space-4`. Type: title 16/20 600, line small 14/20, value 14/20 600, money Newsreader 500 16/20.

## Accessibility
- A list of links. The link's name is its visible text, in reading order: title, value, line.
- Keyboard: Tab to each row, Enter opens it.
- Target: at least 56px tall, full width.

## Rules
- One link per row, never a button inside it.
- A value never replaces the title. Text wraps; nothing is cut off with an ellipsis.
