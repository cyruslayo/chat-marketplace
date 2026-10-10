# Decide WhatsApp's role at launch

Status: resolved
Type: grilling
Blocked by: none

## Context

Nigerian guests already book shortlets by messaging agents on WhatsApp. ADR 0067 and ADR 0077 allow WhatsApp for discovery, status, reminders and handoff, and send payment, identity and contract steps to the web. `domains/shortlet/src/whatsapp-adapter.ts` formats messages, but nothing connects to the WhatsApp Business API yet.

## Options considered

1. Human-run WhatsApp Business number as the front door, sending guests to the web app to book.
2. Connected WhatsApp Business API concierge, handing off to the web for payment.
3. Web app as the whole product, with WhatsApp as a support channel only.

## Acceptance criteria

- [x] An option is chosen and recorded, with the reason.
- [x] If option 2 is chosen, an implementation issue is written against ADR 0067 and ADR 0077. (Not chosen.)

## Answer

Decided by the user, 27 Sept 2026: **option 3. The web app is all-in-one; the product is not WhatsApp first.**

- Guests explore cities, find apartments, book, pay and manage their stay in the web app. The agent drives discovery and Weaver renders the UI.
- WhatsApp is, at most, a support channel: a human-run number for questions, arrival help and incidents, which sends guests back into the app. It is not a discovery or booking channel at launch.
- Reason: agent-led discovery in the app is the product's core experience, and moving discovery to WhatsApp would sideline it.

Consequences:
- Discovery quality in the app becomes launch-critical (see issue 10 and `.scratch/guest-chat-first-ux/`).
- Acquisition must bring guests into the web app directly (issue 12).
- A connected WhatsApp integration (`whatsapp-adapter.ts`) stays paused (issue 14).
