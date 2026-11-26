Tiles show an apartment's size facts (bedrooms, bathrooms, how many it sleeps) as three equal tiles, so the guest can compare apartments at a glance on the unit detail screen.

**Maps to:** `.ui-tiles` and `.ui-tiles__tile` (shipped; markup from `unitTilesHtml` in `guest-kit.ts`, icons `bed`, `bath`, `users`).

## Anatomy
1. `<ul>` container with `aria-label="Stay facts"`, a three-column grid.
2. Tile (`__tile`): `surface-subtle` ground, `radius-md`.
3. Icon: 20px line icon in `indigo`, decorative (`aria-hidden`).
4. Text: the whole fact as words, "2 bedrooms", small 14/20 600 in `ink`.

## Variants
| Variant | Use |
| --- | --- |
| Three tiles | Bedrooms, bathrooms, sleeps, in that order. The only variant. |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover, focus, busy, disabled | Not interactive, so none. |
| Success, invalid, stale | Not applicable. |
| Loading | Three skeleton blocks of the same size. |
| Missing fact | The tile is left out; the others keep their width. Never "0 bathrooms" or a dash. |

## Tokens
`surface-subtle`, `ink`, `indigo` (icon), `radius-md`, `space-2`. Type: small 14/20 600.

## Accessibility
- A list, so screen readers announce "Stay facts, list, 3 items". The icon is hidden; the text carries the fact.
- At 320px the text wraps inside its tile rather than shrinking below 14px.

## Rules
- Facts come from the unit record, never from a photo or the model.
- Only size facts. Prices, deposits and policies go in the Price breakdown or the Facts list, not in tiles.
