A chat message is one turn in the conversation: the guest's own words on an indigo-subtle bubble, or the concierge's reply in plain text under its persona label "Concierge · Stays".

**Maps to:** `.ui-conversation`, `.ui-message`, `.ui-message--guest`, and the persona label `.ui-persona` (`__mark`, `__mode`, `--human`). New: the shipped chat uses `.me`, `.who` and `.bot` in the client.

## Anatomy
1. Guest message: right-aligned bubble, `indigo-subtle` ground, `ink` text, at most 85% wide.
2. Persona label: the mode mark, "Concierge", and "· Stays" in `--mode-accent`. Under human takeover: the person's initials and "Tolu from the Xenia team".
3. Concierge message: plain body text, no bubble, at most 34em wide. Cards (Chat card, Stay card, Banner) follow it in the flow.

## Variants
| Variant | Use |
| --- | --- |
| Guest | The guest's own words. |
| Concierge | Automated replies. It says "I" and never claims to be human. |
| Human (`.ui-persona--human`) | A person who took over; the mark shows no AI activity. It is a 24px square with 12px 700 initials (18px and 10px before 25 Nov 2026; 12px is the floor). |

## States
| State | What changes |
| --- | --- |
| Idle | As the variant. |
| Busy | The concierge is working: "Checking your stays…" in `ink-secondary` under the persona label, cancellable from the composer (R8). No typing dots. |
| Failed | A Banner in the flow: problem, effect and next action ("I couldn't load your stays…"). |
| Hover, focus, success, invalid, disabled | Not applicable; links inside have their own states. |
| Stale | Old cards in earlier turns stay as history; a stale card says so (Banner, stale). |

## Tokens
`indigo-subtle`, `ink`, `ink-secondary`, `surface-subtle`, `--mode-accent`, `--mode-subtle`, `radius-lg`, `radius-sm`, `space-2`. Type: body 16/24, persona 13/16 700.

## Accessibility
- The conversation is a log (`role="log"` on its container); new concierge turns are announced politely.
- The persona label is text, so the speaker is clear without colour.

## Rules
- Never a human name for the concierge; "Xenia Concierge · Stays" in full where a heading needs it.
- An automatic mode switch is always disclosed in the conversation.
