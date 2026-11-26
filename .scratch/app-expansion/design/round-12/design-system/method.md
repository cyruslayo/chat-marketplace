# How we art-direct

Our reference is Andy Clarke, *Art Direction for the Web* (Smashing Magazine, 2019). This page summarises the parts of the book's method we use, in our own words, applied to Xenia. Page numbers are given so you can read the original.

## 1. Start from feelings, not styles (ch. 1, pp. 23–26)

Clarke treats art direction as using design on purpose to make someone feel something. Pictures, layout and type are the result, not the aim. Before designing any screen, say how the guest should feel there, and how strongly.

Our guests are committing real money or real time, usually on a phone. In every mode, the feelings to design out are **apprehension, confusion, scepticism and stress**, and the feelings to design in are **confidence, trust and relief**.

How strongly a screen should make someone feel something depends on the mode. Stays aims for *settled*. Events can reach for real **anticipation**, and Community for **welcome**. That extra intensity is carried only by the mode's accent, mark, copy and photography (see the Modes page). Screens about money, consent or status stay at the calm end of the scale in every mode.

## 2. The feeling map of the booking journey (ch. 4, pp. 88–90)

Clarke maps the journey by what the person is doing *and* how they feel at each step. Here is ours, using the journey from the guest UX strategy:

| Moment | The guest's question | Feeling to avoid | Feeling to create | How art direction gets there |
| --- | --- | --- | --- | --- |
| Entry | "Can this help with my trip?" | Scepticism | Curiosity, then confidence | A real apartment photo, or a labelled illustration until listings exist; one composer; a plain promise. No AI framing. |
| Search | "What fits my dates and group?" | Confusion | In control | The guest's own criteria shown as chips they can edit. Calm, low density. |
| Compare | "Which stay suits me?" | Apprehension about cost | Confidence | Uniform cards with the All-In Stay Total at the strongest emphasis. |
| Detail | "What exactly will I get?" | Scepticism | Trust | Large, honest daylight photos. Facts grouped and never hidden behind media. |
| Review | "What happens if I submit?" | Apprehension | Confidence | Everything on one page, with a direct edit link next to each fact. |
| Waiting | "Is it booked?" | Anxiety | Reassurance | One status, an absolute WAT deadline, and "no Reservation yet" stated plainly. |
| Offer | "What changed, and when must I act?" | Stress | Anticipation | Changes called out explicitly. A quiet countdown beside the absolute time. |
| Payment | "Where am I paying, and did it work?" | Fear of losing money | Trust | A clear boundary with the payment provider. "Checking payment", never false success. |
| Confirmation | "What do I have now?" | Doubt | Relief, then settled | A receipt-like layout: reference, dates and amount, ready to forward to an employer. |

One more moment applies to every mode:

| Moment | The guest's question | Feeling to avoid | Feeling to create | How art direction gets there |
| --- | --- | --- | --- | --- |
| Mode switch | "Did I lose my booking?" | Disorientation | Continuity | The new mark and persona name, a divider row, the old task named as still there, an undo after an automatic switch, and a confirmation when work is at risk (ADR 0107 decisions 8 and 11). |

Events is the first second domain. Its feeling map gets written with its ADR and CONTEXT.md, once its real steps are known. Community and Services follow the same rule. The Modes page has one hypothesis row for each.

This is the main place art direction does its work in this product. A design choice for a screen is right when it moves the guest from the left-hand feeling to the right-hand one.

## 3. Brand values and design principles are different things (ch. 4, pp. 72–77)

- **Brand values** describe what customers should say about us. Clarke warns against words like "friendly", "professional" or "reliable", which would fit any competitor. That is why each of our values is written as *this, not that*, and each comes with a line in the guest's own voice (README).
- **Design principles** are short tests for judging whether a design reflects the brand. Ours, one per value, in rank order:
  1. **Plain** — show it as it is.
  2. **Exact** — money and time first, absolute and precise.
  3. **Calm** — one next step, everything else quieter.
  4. **Light** — it works on a cheap phone before it looks good.
  5. **Spoken** — words a knowledgeable host would actually say.
- Clarke recommends agreeing the values and principles together, not alone, and putting them where people will see them, for example as posters. The cover and the decision test serve that purpose for now.

## 4. Foundation styles give the personality (ch. 1, pp. 26–28)

Colour, photography, layout and type together form what Clarke calls *foundation styles*: the parts that give a design its personality. Ours are on the Art direction page, and every rule there is tied to a value.

## 5. The system is boring on purpose; art direction lives in chosen moments (ch. 4, pp. 87–88)

Clarke agrees that design systems should handle the mundane consistently, but warns that products built on them become forgettable unless they carry the brand's own character. For us:

- **System surfaces** are forms, status panels, criteria chips, result cards, payment and errors. They stay strictly consistent: one label, one look and one money order everywhere (ADR 0077). Value 2 (Exact) wins here, so result cards never vary for visual interest. The surface catalogue sets the boundary (ADR 0108):
  - Tier 1 platform components and tier 2 shared archetypes carry no domain vocabulary or copy. They look identical in every mode except for `--mode-*` accents.
  - A mode's character lives only in its tier 3 domain components and its presentation copy.
- **Directed moments** get deliberate composition and larger photography, with the one italic accent allowed:
  - the landing page;
  - the unit detail hero;
  - the waiting state;
  - the confirmation receipt;
  - seasonal campaign pages;
  - each mode's empty state and Agent Mark;
  - the mode switch.
- The brand's character on system surfaces comes from type, colour, wording and proportion, never from one-off components.

## 6. The design principles applied (ch. 5)

| Principle in the book | What we use | What we rule out (and the value that rules it out) |
| --- | --- | --- |
| Balance: symmetry and asymmetry | Asymmetric balance at desktop: a large photo against a narrow fact column on unit detail. Symmetry for the receipt. | Diagonal or rotated layouts in the app layer. [Calm] |
| Contrast | Contrast in type size makes the All-In Stay Total the loudest thing on a card. Serif headlines against sans UI text. | Using colour alone to show contrast between states. [Plain] |
| Harmony and tension | Harmony throughout the app. Tension is allowed only in landing headlines, through the italic accent. | Tension near money or consent. [Calm, Exact] |
| Scale | A full-height photo on phone landing and the detail hero. A small type size for metadata. | Scaling money or deadlines down to metadata size. [Exact] |
| Proportion and ratio | A consistent photo ratio across cards. A 4px spacing base. | Arbitrary one-off spacing. [Calm] |

## 7. Grids, type and pictures (chs. 6–8)

- **Grids (ch. 6):**
  - Single column is the base layout on a phone.
  - On desktop, the conversation and workspace form two asymmetric columns.
  - The landing page may use a compound grid.
  - Clarke's advice on stacking for small screens backs our phone-first content order.
  - We don't use modular or rotated grid components in the app layer. [Light, Calm]
- **Type (ch. 7):**
  - Use white space under headlines and deep head margins on directed moments.
  - Keep a measure of about 70ch.
  - Use a clear type scale (the tokens).
  - Use tabular numerals and choose numerals deliberately for money.
  - Standfirsts (lede paragraphs) suit the landing page and unit detail.
  - Drop caps and pull quotes stay off product screens.
- **Pictures (ch. 8):**
  - Position images so they direct the eye towards the next action.
  - In editorial runs (landing, campaign pages), vary the rhythm to avoid monotony.
  - Keep comparison grids uniform. [Exact wins over variety]
  - Layered images, irregular shapes and clipping paths are for the landing layer only, and only when they degrade gracefully. [Light]
  - Never let type sit on a photo without a solid scrim. [Light, Plain]

## 8. Building it (chs. 9–12)

The book's CSS Grid, Flexbox, typography and image chapters apply as they are, within our rules:

- features that are Baseline widely available, or feature-detected;
- a low-end Android phone running Chrome as the reference device;
- at most five font files;
- no effects that make contrast over photos unpredictable.
