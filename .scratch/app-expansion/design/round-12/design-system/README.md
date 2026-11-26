**Status: draft for owner review.** The owner's decisions of 20 Nov 2026 are applied here:

- the name is Xenia;
- Services is its own mode;
- Events is the first second domain;
- there is one brand colour;
- the ranking is Honest, Exact, Calm, Light, Spoken.

Adire Indigo is the confirmed brand colour (owner, 20 Nov 2026); the Colour page gives the reasoning. The tokens are the new Xenia palette. They are not yet in `shortlet-foundations.css`, which still carries the old green baseline.

## What Xenia is

*Xenia* is the ancient Greek idea of guest-friendship: the host's duty to welcome a stranger, keep them safe and treat them fairly. That is the brand. **One concierge receives you in Lagos and Abuja and changes focus with what you need.** It is a branded house (ADR 0107): one master brand, Xenia, with Agent Modes inside it.

| Mode | What it does | Status (2026-11-20) |
| --- | --- | --- |
| **Stays** (central) | Whole apartments, through Request to Book | Registered (`GUEST_MODES.stays`) |
| **Events** | Shows, concerts and talks with tickets left | Chosen as the first second domain; no pack yet |
| **Community** | Groups and meetups to join | Planned; playground only |
| **Services** | Help around your stay: airport pickup, housekeeping, a private chef, the planned house-hunt | Decided to be its own mode. Today these exist only inside Stays, as the controlled optional-services catalogue |

Commerce stays parked behind `COMMERCE_ENABLED` and is not a mode (ADR 0104). Services must never become a route to merchant checkout.

**What we look like.** Adire Indigo on warm paper, ink-dark type, an editorial serif, and real photography once listings exist (until then, labelled illustrations). Modes add an accent and a mark, never a new look.

**What we are not.** A chatbot, a menu of bots, a super-app, a SaaS dashboard, a luxury-hotel campaign, a ticketing site with countdowns, or an AI gradient demo.

## The promise

> **Settled, in one conversation.**

*Proposal.* Each mode carries the promise:

- Stays settles you into a home;
- Events and Community settle you into the city;
- Services settles the details.

Stays stays central because the core guests come for a place to live first. These are assignment professionals who expense their stay, new hires relocating, and people between leases. The diaspora winter visit is a seasonal campaign.

## The five values, ranked

The values belong to Xenia, so they hold in every mode. When two conflict, the higher one wins. Each is written as *this, not that*, where *that* is what a plausible competitor would do. The accessibility and network rules of ADR 0078 are floors under all five: no value can trade them away.

### 1. Honest before appealing

*We show what is true, even when something warmer would sell better.* Not: ratings, "selling fast" or "instant".
A guest would say: *"It was exactly what they showed me."* Principle: **Plain**.

- A request is never shown as a confirmation. In Stays, a Booking Request is not a Reservation, and the screen says so at every stage.
- Placeholders are always labelled. Until real listings exist, the brand layer uses illustrations. A specific apartment, event, group or service is never represented by an image of somewhere else.
- No ratings, volumes, testimonials or partner logos. A ticket count, member count or "free for your dates" appears only when it is true.
- The concierge never claims to be human, and an automatic mode switch is always disclosed (ADR 0107 decision 8).

### 2. Exact where commitments are made

*Every commitment is precise and absolute, and sits in the same place each time.* Commitments are price, time, place, seats and deadlines. Not: "from ₦X", "soon", or the key fact below the fold.
A guest would say: *"I knew exactly what I was agreeing to before I tapped."* Principle: **Exact**.

- **Stays.** The All-In Stay Total leads, and the Refundable Security Deposit is shown separately (ADR 0015, 0016). *Proposal:* the receipt can be forwarded as an expense claim.
- **Every mode.** Absolute WAT dates and times, with a countdown only alongside. Real venue and meeting-point names. Full ₦ amounts, set in the face that has the ₦ glyph.

### 3. Looked after, not sold to

*Calm and composed, like a good host.* Not: pressure, glamour or party noise.
A guest would say: *"Nobody rushed me."* Principle: **Calm**.

- One dominant next action per screen. Indigo is a minority colour on warm paper.
- **Energy belongs to the mode; calm belongs to the system.** Events may feel livelier than Stays, but only through its accent, mark, copy and imagery. A mode never changes layout, type, spacing or target sizes (ADR 0107 decision 4). Money, consent and status stay calm everywhere.

### 4. Built for the phone in your hand

*It works on a low-end Android phone on a Lagos network.* Not: hero video, glass or heavy fonts.
A guest would say: *"It worked on my phone, even on bad network."* Principle: **Light**.

- Text and critical facts load before media. No glass or blur. At most five font files.
- Calm now ranks above Light. Within ADR 0078's budgets, a calmer composition wins over a lighter one. For example, a full-height photo or illustration stays if it fits the image budget.

### 5. One concierge, not a menu of bots

*One host who knows each domain, and a real person when needed.* Not: "Ask our AI", a persona per domain, robots or sparkles.
A guest would say: *"I just told them what I needed, and they sorted it."* Principle: **Spoken**.

- The brand is Xenia, and the voice inside it is the concierge. The persona label is "Concierge · Stays", or "Xenia Concierge · Stays" in full. It is never a human name (Language page).
- Modes are told apart by their name and the silhouette of their mark, never by colour alone.
- Under human takeover the mark shows no AI activity, and the person introduces themselves by name.

## How to break a tie

| Conflict | Winner | Example |
| --- | --- | --- |
| Honest vs Calm | Honest | A labelled "Illustration" beats a beautiful unlabelled stock room. |
| Exact vs Calm | Exact | The deposit line, or the meeting time, stays on the card even when it looks busier. |
| Calm vs Light | Calm, within ADR 0078's budgets | A full-height hero illustration stays, as long as it fits the image budget. A sixth font file is still refused, because the font limit is a floor. |
| Mode expression vs system consistency | Consistency | Events gets its accent and mark, not its own card layout. |
| Honest vs One concierge | Honest | "I can only help with stays here. Switch to Events to look for shows." |

## The decision test

1. **Is it true?** Would the guest find exactly this at the apartment, the venue, the meetup or the door?
2. **Is every commitment exact?** Are price, time, place and deadline absolute and at the strongest emphasis?
3. **Is it calm?** Is there one dominant next action, and is mode energy kept out of money and consent?
4. **Does it hold on a cheap phone?** Does it work at 320px, on a slow network, with images off?
5. **Is it the same concierge?** Would it read as Xenia with the accent covered?

If a decision fails a higher question, it fails.

## The pages

- **Colour**: why Adire Indigo, the palette and contrast.
- **Language**: names, voice, tone, mechanics and copy patterns, the foundation for the new copy.
- **Modes**: what a mode may change, the mode wheel and the Agent Marks.
- **Art direction**: rules for photography, illustration, type, shape and motion.
- **How we art-direct**: the method from Andy Clarke's *Art Direction for the Web*, with the feeling map.
- **Decisions**: what is settled and what is still open.

## Using these tokens

- Grounds are `canvas` and `surface`. Text is `ink`, `ink-secondary` or `ink-muted`.
- `indigo` is the one action colour in every mode, with `on-indigo` labels. `indigo-deep` is the inverse surface.
- `sand` appears only on `indigo-deep` and photo scrims. `sand-ink` is its text form on light grounds.
- Each mode's `*-accent` and `*-subtle` reach components only as `--mode-accent` and `--mode-subtle` under `[data-mode]`. They are never used for actions, money or status.
- Status uses `success`, `warning` and `danger`, each with its `*-surface`. Information is neutral `ink-secondary` with an icon.
- `focus` is the amber 3px ring with a 2px offset.
- Headings use `font-display` and UI text uses `font-sans`. `money-total` is for every ₦ total.
- Placeholder imagery follows the **Placeholder** card.
