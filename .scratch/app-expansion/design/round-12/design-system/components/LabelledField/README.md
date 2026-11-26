A labelled field is one native input with a visible label above it, an optional hint, and an error that says what to do.

**Maps to:** `.ui-field` with `__label`, `__hint`, `__input`, `__error`. Choices inside a field use `.ui-choice` and `.ui-legend`.

## Anatomy
1. Label (`<label for>`), always visible. "(optional)" in `ink-secondary` when it is.
2. Hint: what to enter or where to find it ("From the business account, not from the Guest's receipt.").
3. Input: native `<input>`, `<select>` or `<textarea>`, 48px tall, 16px text so phones don't zoom.
4. Error: a warning icon and a sentence with the fix, under the input.

## Variants
- Text, phone, email, number, select, textarea.
- Choice group: a `<fieldset>` with a `<legend>` and native radios or checkboxes, each label a 44px target.
- Short placeholder or none. A placeholder never replaces the label or the hint, and at 320px the hint carries the guidance, so nothing is cut off.

## States
| State | What changes |
| --- | --- |
| Idle | 1px `border` on `surface`. |
| Hover | No change (the cursor is the cue). |
| Focus | Border turns `indigo`, plus the 3px `focus` ring with a 2px offset. |
| Busy | Not a field state. The form's button shows busy; the field stays editable until submit. |
| Success | No green tick. A saved value shows as a fact ("Phone: +234 801 234 5678"). |
| Invalid | `aria-invalid="true"`, a 2px `warning` border, and the error line linked with `aria-describedby`. |
| Disabled | `surface-subtle` ground, `ink-secondary` text, `border-subtle`. Use read-only facts instead when possible. |
| Stale | The form's stale banner covers it. The value is kept so nothing is retyped. |

## Tokens
`surface`, `surface-subtle`, `border`, `border-subtle`, `indigo`, `ink`, `ink-secondary`, `ink-muted` (placeholder only), `warning`, `focus`, `radius-sm`, `space-1`, `space-2`. Type: label 16/20 600, body 16/24, small 14/20.

## Accessibility
- Name: the `<label>`. Description: the hint and the error, through `aria-describedby`.
- Role: native (`textbox`, `combobox`, `radio`, `checkbox`).
- Keyboard: Tab between fields, arrow keys inside a radio group, Space to tick a checkbox.
- Target: inputs are 48px tall; each choice label is 44px tall.

## Rules
- Errors use `warning`, not `danger`: the guest or operator can fix them.
- Phone numbers accept local and +234 forms (Forgiving Format, R7).
- Never ask for a guest's name: the product doesn't collect one.
