The Ask bar is the Composer as a link: one line above the tab bar that opens the concierge with the current page as its subject, such as "Ask about this stay".

**Maps to:** `.ui-ask` (new) around `.ui-composer.ui-composer--link` (new variant of the Composer).

## Anatomy
1. `.ui-ask`, pinned above the tab bar.
2. One link holding the label (`.ui-composer__input`) and a chat icon (`.ui-composer__send`, decorative).

## Variants
| Page | Label |
| --- | --- |
| List, saved | "Ask about these stays" |
| One stay | "Ask about this stay" |
| Your stays | "Ask about your stays" (with more domains, "Ask about your plans") |
| Payments | "Ask about this payment" |
| Request waiting | "Ask about this request" |
| Account, Help | "Ask the concierge" |

## States
| State | What changes |
| --- | --- |
| Idle | `surface`, 1px `border`. |
| Hover | The edge turns `ink`. |
| Focus | 3px `focus` ring. |
| Hidden | While a person handles the matter (ADR 0076), in a full-screen task, and in the conversation, which has the real Composer. |
| Concierge unavailable | The bar stays. The page it opens says so and offers the list (ADR 0080). |
| Busy, success, invalid, disabled, stale | Not applicable: it is a link. |

## Tokens
`surface`, `canvas`, `border`, `border-subtle`, `ink`, `ink-secondary`, `indigo` (icon only), `radius-xl`, `space-2`. Type: body 16/24.

## Accessibility
- Role: link, named by its visible label. It is not a text field and must not look filled in, so the label is `ink-secondary` and never a blinking caret.
- Keyboard: Tab reaches it after the page content and before the tab bar. Enter opens the conversation with focus in the Composer.
- Target: 48px tall, full width.

## Rules
- It names the page. Never "Ask me anything".
- Opening it changes nothing and sends nothing. It carries the page as context, not as guest-authored text (ADR 0106).
- From 768px it sits at the foot of the content column, at most 756px wide.
