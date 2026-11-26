A disclosure confirm keeps a rare or reversing action closed behind its name, and once opened shows what it will change before its button commits it.

**Maps to:** `.ui-confirm` (shipped), with `__body` and the effect note `.ui-effect`.

## Anatomy
1. Summary: the action's name with a trailing ellipsis in code ("Decline this transfer…", "Uphold this complaint…") and a chevron.
2. Body: the inputs the action needs (reasons as radios, a first affected night, a reference).
3. Effect note: "What this changes" or "What this does", then the consequence, naming the Guest as "the Guest".
4. Commit button: quiet, named for the command ("Decline transfer", "Uphold and end the stay").

## Variants
| Variant | Use |
| --- | --- |
| Closed | Default for every rare action (decline, dismiss, uphold, money arrived after all). |
| Open | Shows inputs, effect and button. Only one should be open at a time. |
| Final step | The refund, the only blocking confirmation: an in-page step titled with the amount ("Record ₦370,000 refunded to the Guest?"), "This is final", and "Yes, record the refund" with "Go back". Focus moves to its heading when it opens. |

## States
| State | What changes |
| --- | --- |
| Idle | Closed, `surface` with a `border-subtle` ring. |
| Hover | The summary text underlines. |
| Focus | 3px `focus` ring on the summary. |
| Busy | The commit button shows busy ("Declining…"); the inputs stay visible. |
| Success | The disclosure is replaced by an outcome panel; the action can't be repeated. |
| Invalid | A required choice that is missing shows a field error: "Choose a reason before declining. Nothing was changed." |
| Disabled | Not shown when the action isn't allowed. It is removed, not greyed. |
| Stale | The page's stale banner; the commit is refused and nothing changes. |

## Tokens
`surface`, `surface-subtle`, `border-subtle`, `ink`, `focus`, `radius-md`, `space-4`, plus the Button and Labelled field tokens.

## Accessibility
- Native `<details>` and `<summary>`: role button, with the expanded state exposed. Enter or Space toggles it.
- Inside: a `<fieldset>` with a `<legend>` for the choices.
- Targets: the summary is 52px; the choices and the button are 44px.

## Rules
- The primary action of the page never sits inside a disclosure.
- Declining stays quiet: no danger colour on the button.
- Effect text never names a person who isn't a party: "Makes the Reservation and tells the Guest it is confirmed."
