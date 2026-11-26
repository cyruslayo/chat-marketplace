The view switch shows the same search in two ways, Concierge or List, and keeps one set of criteria between them.

**Maps to:** `.ui-segmented`. Shipped today as a radio group (theme choice, payment methods). The link form is new and is the view switch; the radio form keeps its shipped markup.

## Anatomy
1. `<nav aria-label="Show this search as">`.
2. Two links, "Concierge" and "List". The current one has `aria-current="true"`.

## Variants
| Variant | Markup | Use |
| --- | --- | --- |
| View switch | `<nav>` with two `<a>` | Each view has its own address and can be opened from a link. |
| Choice | `<fieldset>` with two radios and labels | A setting inside a form (shipped). |

## States
| State | What changes |
| --- | --- |
| Idle | `ink-secondary` on the `surface-subtle` track. |
| Hover | `ink` text. |
| Focus | 3px `focus` ring. |
| Current | `surface` fill, 1px `border`, `ink` 700. |
| Busy | The chosen option reads "Loading list…" with `aria-busy="true"`; the old view stays until the new one is ready. |
| Concierge unavailable | Both options stay. The concierge view shows the Banner that leads to the list. |
| Success, invalid, disabled, stale | Not applicable. |

## Tokens
`surface`, `surface-subtle`, `border`, `ink`, `ink-secondary`, `focus`, `radius-md`, `radius-sm`, `space-1`. Type: label 16/20 600, current 700. `radius-pill` is not used, because the token allows it only on criteria chips and the guest primary action.

## Accessibility
- Role: navigation with two links. The current one is announced by `aria-current`.
- Keyboard: Tab to each, Enter to open. The radio form uses arrow keys.
- Targets: each option is at least 136 × 44px at 320.

## Rules
- Two options only.
- A filter changed in the list is the guest's own structured input (ADR 0106), so the concierge uses it too.
