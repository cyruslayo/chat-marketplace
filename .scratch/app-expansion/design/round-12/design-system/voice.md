# Language

These are the foundations for writing Xenia's new copy. They come from the ranked values. Every example on this page is a **draft** written for Xenia: none of it is approved product copy yet. Copy ships from `apps/web-agent/src/guest-content.ts` (product) and `apps/local-guest/src/landing-copy.ts` (landing), after owner approval.

## 1. Names

| Name | How to write it | Rules |
| --- | --- | --- |
| **Xenia** | Xenia (say it *ZEN-ee-uh*) | The master brand. Never all caps, and never "the Xenia". In running text: "Xenia finds you…", "the Xenia team". |
| **The concierge** | lower case in sentences, "Concierge" in labels | The automated guide the guest chats with. It is a role, not a person. It has no human name and never claims to be human (value 1). |
| **Mode labels** | Stays · Events · Community · Services | Plural nouns, title case, one word each. |
| **Persona label** | Concierge · Stays | The compact label next to the Agent Mark. In the full form, such as an empty-state heading or an announcement, write "Xenia Concierge · Stays". |
| **Xenia · Partner** | Xenia · Partner (with a middle dot), the same form everywhere | The operator-facing product (approved by the owner, 21 Nov 2026). Use it on request cards and in the partner app's header. Until the partner app ships, any screen of it shown publicly is labelled as planned ("the partner app we're building with founding partners"). At launch the Xenia team confirms requests on the operator's behalf. |
| **People** | Their first name, then "Xenia team" or their role | A human who takes over: "Tolu from the Xenia team". In Stays, the domain term **Operator** stays where policy uses it. |

**Why "Concierge" and not "Xenia" as the persona.** Xenia is also a person's first name. If the agent spoke as "Xenia", guests would reasonably think they were chatting with a woman named Xenia, which would break Honest. It would also blur the handover to a real person (ADR 0076). The brand is Xenia; the voice inside it is the concierge. This keeps ADR 0107's settled "one concierge" and adds the master name above it.

## 2. Voice: the same in every mode

The voice is how Xenia always sounds. It comes straight from the values.

| Value | Voice trait | We sound | We never sound |
| --- | --- | --- | --- |
| 1 Honest | **Plain** | Factual, specific, upfront about limits | Hyped, vague, falsely certain |
| 2 Exact | **Precise** | Full amounts, absolute dates and times, named places | Approximate ("around", "soon", "from ₦…") |
| 3 Calm | **Steady** | Unhurried and reassuring, one step at a time | Pushy, urgent, gushing |
| 4 Light | **Brief** | Short sentences, the key fact first, readable on a small screen | Padded, clever, wordy |
| 5 Spoken | **Warm, like a good host** | Natural, kind, Nigerian English | Robotic, corporate, slangy |

## 3. Tone: it shifts by moment

The voice stays fixed; the tone moves along a dial. It follows the feeling map on the "How we art-direct" page.

| Moment | Tone | Draft example |
| --- | --- | --- |
| Welcome and empty state | Warm, open | "Tell me where and when. I'll show you what's free." |
| Search and results | Helpful, neutral | "Three apartments in Lekki are free for those dates." |
| Money and commitments | Precise, neutral, no adjectives | "All-In Stay Total: ₦1,295,000 for 7 nights." |
| Waiting | Reassuring, specific | "Your request is with the Operator. You'll have an answer by 6:30 PM WAT today." |
| Problems | Steady, solution first | "That date has passed. Pick a check-in date from today onwards." |
| Success | Quietly glad | "You're booked. Your receipt is below." |
| Events (hypothesis) | Lively, still no pressure | "Four shows in Lagos this weekend still have tickets." |
| Community (hypothesis) | Welcoming, clear about who and where | "This running group meets at 6:00 AM on Saturdays in Ikoyi. Beginners are welcome." |
| Services (hypothesis) | Practical, dependable | "Airport pickup from Lagos airport is available for your arrival." |

## 4. Who speaks

- **The concierge says "I"** in the conversation ("I found…", "I can't see that detail"). It never says "we" to mean itself.
- **Xenia says "we"** in product chrome and on the landing page ("We check every apartment before it's listed", once that claim is true).
- **The guest is "you".** Starter chips and quick replies are written in the guest's own voice: "Find a stay in Abuja", not "Explore Abuja".
- **A person** introduces themselves by name when they take over. While they are in the chat, the concierge says nothing in the first person.

## 5. Mechanics (en-NG)

- **Spelling.** British spelling, as used in Nigeria: colour, organise, cheque, programme.
- **Case.** Sentence case for headings, buttons and labels. Title case only for names, mode labels and domain terms (All-In Stay Total, Request to Book).
- **Money.**
  - "₦1,295,000", with a comma for thousands and no decimals unless kobo apply.
  - Never "₦1.3m" for a commitment.
  - Always set in the face that has the ₦ glyph.
- **Dates.**
  - "Fri 27 Nov 2026" on cards, "Friday 27 November 2026" in sentences.
  - No ordinals, and never a numbers-only date like 27/11.
- **Times.** "6:30 PM WAT". A deadline always gives an absolute time. A countdown may sit beside it, never in its place.
- **Durations.** "7 nights", "3 months". Use numerals for every count.
- **Phone numbers.** "+234 801 234 5678".
- **Places.** Area, then city: "Lekki Phase 1, Lagos".
- **Contractions.** Allowed in conversation and empty states ("you'll", "I can't"). Avoid them in legal or commitment lines.
- **Punctuation.** No exclamation marks in system copy. At most one in a celebration, if any. No emoji in the product.

## 6. Three layers of vocabulary

| Layer | Owns | Examples | Where it lives |
| --- | --- | --- | --- |
| **Brand** | The name and the promise | Xenia, concierge, settled | This page |
| **Platform** | Words every mode shares | request, offer, payment, receipt, deadline, switch, chat, team | Tier 1 and 2 components carry no domain words (ADR 0108); shared copy lives in `guest-content.ts` |
| **Mode** | Each domain's own terms | Stays: All-In Stay Total, Refundable Security Deposit, Amount Due Now, Request to Book, Operator, Reservation | That domain's `CONTEXT.md`. Events, Community and Services define theirs in their domain ADRs. |

Canonical domain terms stay exactly as their `CONTEXT.md` defines them. New copy is written *around* them, never replacing them.

## 7. Words to use and words to avoid

| Avoid | Why | Use instead |
| --- | --- | --- |
| instant, guaranteed, best, perfect | Promises we can't keep (Honest) | Say what actually happens: "the Operator confirms first" |
| hurry, selling fast, last chance, don't miss out | Pressure (Calm) | The real number and the real time |
| luxury, exclusive, premium | Glamour, not hospitality | The concrete feature: "2 bedrooms, generator backup" |
| AI, bot, smart, magic, seamless | Makes the technology the hero | concierge, or just the action |
| Oops, Uh-oh, Whoops | Makes light of a problem | State the problem plainly |
| Unfortunately, We regret to inform you | Corporate | "That date isn't available." |
| Click here, Submit | Says nothing about the result | Verb plus object: "Send request", "Pay ₦250,000" |
| "from ₦…" | Approximate | The All-In Stay Total for the guest's own dates |

## 8. Copy patterns

These are templates, not final copy.

- **Empty state.** The heading says what the guest can do. The body says what to tell us and what happens next. Give two to four starters in the guest's voice. *Draft:* "Find a place to stay" / "Tell me the city, your dates or how long you'll stay, and how many people. I'll show you whole apartments that are free, and help you request one."
- **Composer placeholder.** The facts we need, in order: "City or area, dates, guests".
- **Buttons.** A verb plus an object, and the amount when money moves: "Pay ₦250,000 now".
- **Status line.** The state, then what it means, then what happens next. "Request sent. Your dates are held until 6:30 PM WAT while the Operator replies."
- **Error.** The problem, then its effect, then the next action (UX guideline §9).
- **Mode switch (tier C suggestion).** "That sounds like Events. Switch to Events? Your stay request stays here." Buttons: "Switch to Events" and "Stay here".
- **Automatic switch notice.** "Switched to Events. Your stay chat is still in the menu." Button: "Undo".
- **Out of scope.** "I can only help with stays here. Switch to Events to look for shows."
- **Human handover.** "Tolu from the Xenia team has joined the chat."
- **Receipt.** Reference, then what is confirmed, dates, amount paid, and who to contact. No adjectives.

## 9. Copy checklist

Check each line against these before it goes for approval:

1. Is it true now, not only once a feature ships?
2. Is every amount, date, time and place exact and absolute?
3. Does it lower pressure rather than add it?
4. Can a guest read it at 320px in one glance, and does the key fact come first?
5. Would a good host say it out loud?
6. Does it use the canonical domain term where one exists?
