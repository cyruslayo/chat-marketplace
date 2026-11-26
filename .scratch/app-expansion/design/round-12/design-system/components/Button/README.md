A button starts one command, and its label names that command's consequence ("Confirm payment", "Submit Booking Request"), never "Continue" or "Next".

**Maps to:** `.ui-button` with `--primary`, `--secondary`, `--quiet`, `--small`, `--block`, and `--pill` for the guest primary only.

## Anatomy
1. Container: a native `<button>`, or `<a href>` when it navigates.
2. Label: a verb plus an object, sentence case, with the amount when money moves ("Pay ₦250,000 now").
3. Optional leading icon, 20px, always beside a word.

## Variants
| Variant | Use | Tokens |
| --- | --- | --- |
| Primary | The one dominant action on a screen. | `indigo`, `indigo-hover`, `indigo-pressed`, `on-indigo` |
| Primary pill | Guest screens only: the primary action (`--pill`, 52px). | as primary, `radius-pill` |
| Secondary | A quiet second action that still matters ("Edit search"). | `indigo-subtle`, `indigo` |
| Quiet | Every other action, and every operator action that is not the primary ("Decline transfer"). | `border`, `ink`, `surface-subtle` on hover |
| Small | Dense rows (queue items, chat cards). Still 44px tall. | as its variant |
| Block | Fills its column on phones. | — |

Operator buttons always use `radius-md`; the pill is for the guest primary and criteria chips only.

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover | Primary darkens to `indigo-hover`; secondary gains a 1px `indigo` ring; quiet fills `surface-subtle`. |
| Focus | 3px `focus` ring, 2px offset, on the page ground. Never removed. |
| Busy | `aria-busy="true"`, label changes to the present participle ("Confirming payment…"), the button stays the same size and is not pressable twice. No spinner. |
| Success | A button does not show success. After the command, the screen replaces it with an outcome panel, so a decided action cannot be pressed again. |
| Invalid | Not a button state. The form shows field errors and keeps the button enabled. |
| Disabled | `surface-subtle` ground, `ink-secondary` label, `border-subtle` ring. Only with a visible reason beside it (for example Operator Active Hours); Tab skips it, so the reason is in the reading order. |
| Stale | The button is disabled under a warning banner that says the record changed, with "Show the latest". |

## Tokens
`indigo`, `indigo-hover`, `indigo-pressed`, `on-indigo`, `indigo-subtle`, `border`, `border-subtle`, `surface-subtle`, `ink`, `ink-secondary`, `focus`, `radius-md`, `radius-pill`, `space-2`. Type: label (16/20, 600); small 15/20.

## Accessibility
- Role: `button` (native), or `link` when it is an `<a href>`. The name is the visible label; an icon-only button needs `aria-label`.
- Keyboard: Tab to reach, Enter or Space to press (Enter only for a link).
- Target: at least 44 × 44px in every variant, 48px by default.
- Colour is never the only signal: the label says what the button does.

## Rules
- One primary per screen. Everything else is secondary or quiet.
- Never "Submit", "Click here", "Continue" or "Next".
- Danger colours are never used on a button: declining is a routine answer and stays quiet.
