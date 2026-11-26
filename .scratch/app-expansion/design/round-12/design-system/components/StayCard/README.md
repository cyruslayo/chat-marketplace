A stay card shows one apartment in the matching stays, with its title, area, facts and the All-In Stay Total for the guest's own dates, and opens that apartment.

**Maps to:** `.ui-stay-card` with `__media`, `__photo`, `__photo--empty`, `__count`, `__label`, `__body`, `__where`, `__title`, `__facts`, `__total` (shipped; `__body` and `__label` are new). `.stay-card` stays as the client's hook.

## Anatomy
1. Media, 16:10: the listing photo, or `__photo--empty` ("Listing photo" with a "Placeholder" label) when there is none. Count tag "1 / 7".
2. Where: area and city, with a pin icon ("Old Ikoyi, Lagos").
3. Title: the listing title, a link to the apartment (one action per card).
4. Facts: bedrooms, bathrooms, sleeps, as quiet tags. Only facts the listing has.
5. Total: the money-total figure, "All-In Stay Total for 3 nights", and "+ ₦20,000 Refundable Security Deposit (separate)" when there is one.

## Variants
| Variant | Use |
| --- | --- |
| With photo | Real listing photos. |
| No photo | The labelled placeholder. Never an illustration and never a photo of somewhere else (Placeholder card). |
| Demo listing | Adds the `.ui-chip--demo` "Demo listing" label (ADR 0105). |

One column on phones; two from 768px in chat; the desktop discovery workspace may show three.

## States
| State | What changes |
| --- | --- |
| Idle | As above. |
| Hover | The title underlines. |
| Focus | 3px `focus` ring on the title link. |
| Loading | A card-shaped Skeleton, text first. |
| Busy, success, invalid, disabled | Not applicable. |
| Stale | The criteria changed: the conversation replaces the cards; old cards are never shown with old prices. |

## Tokens
`surface`, `border-subtle`, `surface-subtle`, `canvas`, `ink`, `ink-secondary`, `--mode-subtle`, `radius-lg`, `radius-sm`, `space-4`. Type: h3 19/26 600, small 14/20, `money-total` 24/30.

## Accessibility
- An `<article>`; the title is the one link. The media is `role="img"` with an `aria-label`, or `alt` on a real photo.
- Keyboard: Tab to the title.
- Target: the title link is 44px tall (measured) and as wide as the card body. It was 26px before 25 Nov 2026.

## Rules
- Text and the total paint before the image (Light).
- No ratings, "selling fast" or "from ₦…" (Honest, Exact).
