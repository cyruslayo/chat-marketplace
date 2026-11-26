The app bar is the top of every guest screen: back, the Xenia wordmark, the mode label "Concierge · Stays" and the account action, so a guest dropped onto any screen can tell where they are and how to get back.

**Maps to:** `.ui-appbar` with `__brand`, `__grow`, `__action`, `__label`, plus the mode label `.ui-mode-label` (`__mark`, `__mode`) inside `[data-mode]`.

## Anatomy
1. Back (`.ui-appbar__action`, icon only, named for its destination: "Back to your conversation", "Back to results").
2. Wordmark "Xenia" in Newsreader, a link home. Until the logo exists this is plain type (decision 5).
3. Mode label: the mode mark, then "Concierge · Stays". The mode word takes `--mode-accent`.
4. Grow spacer.
5. Help: icon below 640px, icon and "Help" from 640px.
6. Optional text action: "New conversation" (conversation only, from 640px; below that it is in the conversation).

Your stays and Account are in the Tab bar, or in Side navigation from 768px, so the bar no longer carries an account action. A page outside the guest shell keeps the older account action.

## Variants
| Variant | Use |
| --- | --- |
| Booking screen | Back, wordmark, mode label; the Journey rail sits directly below. |
| Conversation | Wordmark, mode label, "New conversation". |
| Root page (Find, Your stays, Account) | No Back. `.ui-appbar--root`, hidden from 768px. |
| In the guest shell from 768px | Back only; Side navigation carries the rest. |

## At 320px
Back, wordmark, mode label and Help do not fit together, so one gives way. Below 368px a page with Back drops the wordmark: Back, "Concierge · Stays", Help. A page with no Back keeps the wordmark. The mode label is never cut, because it tells the guest who they are talking to, and Find in the Tab bar is the way home. With two or more domains the label is a control and shows "Stays" with its mark; its name stays "Concierge, Stays. Change concierge". A task has no wordmark at all (Task bar). Measured at 320, 360 and 390: no bar overflows.

Inside `.ui-app`, under 600px of visible height, the bar is 53px instead of 61px.

## States
| State | What changes |
| --- | --- |
| Idle | As above. |
| Hover | Actions fill `surface-subtle`. |
| Focus | 3px `focus` ring on each action and the wordmark. |
| Human takeover | The mode label stays; the conversation shows the person's own persona label (Chat message), never a change in the bar. |
| Busy, success, invalid, disabled, stale | Not applicable. |

## Tokens
`canvas`, `border-subtle`, `surface-subtle`, `ink`, `focus`, `--mode-accent`, `--mode-subtle` (from `stays-accent` / `stays-subtle`), `radius-sm`, `radius-md`, `space-2`, `space-6`. Wordmark: Newsreader 24/28.

## Accessibility
- Landmark: `<header>`. Icon-only actions have `aria-label`.
- Keyboard: Tab through back, wordmark, actions.
- Targets: every action is at least 44 × 44px.

## Rules
- Modes are told apart by name and mark silhouette, never by colour alone.
- No mode control until a second domain ships (Concierge chooser).
