The action bar holds a screen's one primary action beside the amount it commits to, sticky at the bottom on phones and an inline panel from 768px.

**Maps to:** `.ui-action-bar` with `__sum` (shipped), plus `--sticky` (new).

## Anatomy
1. Sum: the `money-total` figure and its label ("All-in · 3 nights", "Total to complete booking").
2. Primary Button: the guest pill, named for its consequence ("Request to book", "Submit Booking Request", "Accept and pay").

## Variants
| Variant | Use |
| --- | --- |
| Sticky (`--sticky`) | Phones: stays in reach while the guest reads the facts above. |
| Inline | From 768px, a bordered panel at the end of the content. |
| Closed | Outside Operator Active Hours: the disabled button names when sending opens ("Sending opens 8:00 AM WAT"), with the reason in a notice above. |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Hover, focus | On the button. |
| Busy | The button shows the busy label ("Submitting…"); the sum stays. |
| Disabled | As Closed; the reason is always visible above, in reading order. |
| Success | The screen moves to the next step; the bar does not show success. |
| Stale | The stale banner above names the changed amount; the sum shows the new one. |
| Invalid | Not applicable. |

## Tokens
`surface`, `border-subtle`, `ink-secondary`, `radius-lg` (inline), `space-4`, plus the Button and `money-total` tokens.

## Accessibility
- The sum is text before the button, so it is read first. The sticky bar never covers focused content: the page keeps bottom padding equal to its height.
- Target: the pill is 52px tall.

## Rules
- One action only. The amount in the bar is the same as the one in the breakdown.
