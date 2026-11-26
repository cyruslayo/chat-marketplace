A switch divider is the row a change of concierge leaves in the conversation, so the guest can see where one lane ends and the next begins.

**Maps to:** `.ui-switch-divider` with `__text` (new).

## Anatomy
1. Hairline, the Agent Mark of the new mode, "You’re now talking to Concierge · Events.", hairline.

## Variants
One per mode, by `data-mode`.

## States
| State | What changes |
| --- | --- |
| Idle | As above. |
| Arriving | Announced once, politely. No animation is required; under reduced motion there is none. |
| Hover, focus, busy, success, invalid, disabled, stale | Not applicable. |

## Tokens
`border-subtle`, `ink-secondary`, `--mode-accent`, `canvas`, `space-2`. Type: small 14/20.

## Accessibility
- A paragraph inside the conversation's `role="log"`, so it is read once when it is added. Not a separator role, because its text must be read.

## Rules
- Shown only after the server has changed the mode.
- A switch carries no text across. The guest's last message stays in the lane it was sent in.
