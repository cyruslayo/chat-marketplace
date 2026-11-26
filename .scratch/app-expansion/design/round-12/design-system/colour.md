# Colour

**Adire Indigo is Xenia's one brand colour.** The owner confirmed it on 20 Nov 2026. This page explains the choice and how the rest of the palette is derived from it. Every value is generated in OKLCH and checked against WCAG 2.2, in both themes, on 2026-11-20.

## What the brand colour has to do

The values rank as Honest, Exact, Calm, Light, Spoken. Because Honest and Calm both rank high, the colour has to signal **trust** and **steadiness** before it signals excitement. *Xenia* is the ancient Greek idea of guest-friendship: a host's duty to receive and protect a stranger. Expressed as colour, that is a steady host (a deep, quiet hue) on a warm welcome (warm paper ground).

It also has to work as a system colour:

- it is the one action colour in every mode, so it must not look like a status;
- it must carry white text at AAA contrast;
- it must keep all four mode accents and the four status colours distinguishable.

## Candidates

| Criterion | Forest green (current) | **Adire Indigo** | Laterite clay |
| --- | --- | --- | --- |
| Associations (learned and cultural, not universal) | Growth, nature, calm | Depth, trust, steadiness | Warmth, earth, home |
| Local meaning | The national flag, and many telecom and fintech brands | Indigo-dyed adire cloth in the southwest and the dye pits of the north: a craft of care that is shared across Nigeria | Red earth and terracotta |
| Clash with status colours | **Conflicts with success**: the green primary button and the green "confirmed" state are almost the same colour | None. Information status becomes neutral (see below) | Sits next to danger red and warning amber |
| Fits Calm | Yes | Yes, the strongest fit | No; warm, saturated hues read as urgent |
| Room for mode accents | Rules out green for every mode | Leaves the warm half of the wheel free for modes | Takes the warm half the modes need |
| White text contrast | 8.0:1 | **8.7:1** on canvas, 9.5:1 on white | about 6:1 |

Indigo wins on the two highest-ranked values. It doesn't compete with "success", so Honest is protected: a primary button never looks like a confirmation. It is the calmest of the three, and it gives the modes room to be warm.

**Risks.** Blue is common in Nigerian banking and fintech. To stay distinctive, Xenia leans violet-indigo (OKLCH hue 268) rather than a bank's royal or sky blue. The deep, slightly dusty tone pairs with warm paper rather than white.

## The colour theory behind the palette

- **Temperature contrast.** The brand hue is cool, and the ground is warm paper (hue 85). This is the core of the identity: a steady host and a warm welcome.
- **Complementary highlight.** Sand (hue 80) sits opposite indigo on the wheel. It is used only on deep indigo surfaces in the brand layer, such as the landing money band, eyebrows on photos and the italic headline word on dark. Gold on indigo is a classic complementary pairing, and it replaces brass.
- **Tinted neutrals.** Ink and borders carry a trace of indigo, and the paper grounds a trace of sand, so the neutrals belong to the brand instead of being plain grey.
- **Even lightness for modes.** All four mode accents share one OKLCH lightness (0.48 light, 0.78 dark) and differ only in hue. None of them can shout louder than another (Calm), and every one passes contrast by construction.
- **One colour per job.** Indigo means "act". Mode accents mean "where you are". Status colours mean "what happened". Sand means "brand layer". No colour does two jobs.

## The mode wheel

| Mode | Hue | Why this hue | Light | Dark |
| --- | --- | --- | --- | --- |
| Stays (central) | Clay, 45° | Near-complement of indigo, the strongest pairing, for the central mode. Earth and home. | `#934319` | `#EDA382` |
| Events | Hibiscus, 350° | Festive and evening, red-violet. Warm without being red danger. | `#973069` | `#ED9AC1` |
| Community | Lagoon teal, 190° | Openness and conversation, water you gather around. Well clear of sand. | `#046C68` | `#6CCAC4` |
| Services | Palm olive, 118° | Practical and dependable, like workwear and the palm tree. Housekeeping, pickups, chefs. | `#596517` | `#B1C075` |

**Community and brass, resolved.** Community moves from ochre to teal, and brass becomes sand. In dark mode, sand and teal now sit about 110° apart on the wheel, where ochre and brass measured 1.07:1 against each other.

Modes can differ by hue alone, because each one also has its name and its mark's silhouette (ADR 0107 decision 7).

## Status

| Status | Light (on its tint) | Dark (on its tint) | Notes |
| --- | --- | --- | --- |
| Success | `#106C3E` on `#DDF6E4` (5.68:1) | `#73CE95` on `#102A1A` (8.03:1) | Always with a check icon and a word |
| Warning | `#8A5601` on `#FDECD5` (5.31:1) | `#EDBB64` on `#312108` (8.80:1) | Deadlines and holds |
| Danger | `#A12628` on `#FEE9E7` (6.38:1) | `#F08F87` on `#371B19` (6.74:1) | Declines and failures only, never routine expiry |
| Information | `ink-secondary` with an info icon | the same | Neutral, so it is never confused with the brand blue |

The focus ring is amber (`#995600` light, `#F0A556` dark), the complement of indigo, so it stands apart from every action. It is 3px with a 2px offset, which puts it on the page ground at 5.2:1 or better, never on the button itself.

## Contrast, measured

| Pair | Light | Dark |
| --- | --- | --- |
| `ink` on canvas | 15.3:1 | |
| `ink-muted` on `surface-subtle` (the lowest text pair) | 4.97:1 | 6.99:1 |
| `indigo` on canvas | 8.71:1 | 9.47:1 |
| `on-indigo` on `indigo` / `indigo-pressed` | 9.48:1 / 14.41:1 | 9.34:1 / 12.75:1 |
| `sand` on `indigo-deep` | 10.48:1 | 10.17:1 |
| `sand-ink` on canvas | 5.59:1 | |
| Mode accents on canvas | 5.76:1 to 6.56:1 | 9.12:1 to 9.93:1 |

Every mode accent is at least 4.5:1 on canvas, on surface and on its own tint, in both themes. The palette is generated and checked by `.scratch/brand/palette.mjs` in the repo. Re-run it with `node .scratch/brand/palette.mjs` after any change. It reports two "FAIL" lines for the focus ring measured on indigo. Those don't apply, because the 2px offset places the ring on the page ground.
