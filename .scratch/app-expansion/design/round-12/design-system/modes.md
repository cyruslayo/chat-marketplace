# Modes

A mode is how a registered Domain Pack appears to the guest (ADR 0107). Xenia has four: Stays (central and live), Events (the first second domain, chosen 20 Nov 2026), Community and Services (planned).

## What a mode may change and what it may not

| A mode may change | A mode never changes |
| --- | --- |
| Its accent pair, `--mode-accent` and `--mode-subtle` | Layout, spacing, type, radii, target sizes (ADR 0107 decision 4) |
| Its Agent Mark silhouette (a kit icon) | `indigo` as the action colour, the grounds, the ink, the focus ring |
| Its persona label, "Concierge · {Mode}" | The concierge's identity, the voice or the human handover |
| Empty state, starters, composer copy and region labels (`guest-content.ts`) | Tier 1 and 2 components, which carry no domain vocabulary (ADR 0108) |
| Its imagery subject | The imagery rules: real or labelled, never misleading |
| Its tier 3 domain components | The money order, the deadline format, status colours |

Colours never travel in the presentation. Each mode id has a token block in the foundation CSS (ADR 0107 decision 4).

## The mode wheel

Every accent has the same OKLCH lightness, so no mode is louder than another. Only the hue changes. The reasoning is on the Colour page.

| Mode | Accent | Light / dark | On canvas, light / dark | Feeling |
| --- | --- | --- | --- | --- |
| Stays | Clay, 45° | `#934319` / `#EDA382` | 6.31 / 9.27 | Home, earth, settled |
| Events | Hibiscus, 350° | `#973069` / `#ED9AC1` | 6.56 / 9.12 | Evening, festive, anticipation |
| Community | Lagoon teal, 190° | `#046C68` / `#6CCAC4` | 5.76 / 9.93 | Open, gathering, welcome |
| Services | Palm olive, 118° | `#596517` / `#B1C075` | 5.85 / 9.73 | Practical, dependable |

Every accent passes 4.5:1 on canvas, surface and its own tint, in both themes. Modes can differ by hue alone, because the persona name and the mark's silhouette also tell them apart (ADR 0107 decision 7).

## The Agent Mark family

- **One rig, different silhouettes.** Every mark uses the same 64-unit grid, stroke weight and face; only the outline changes:
  - Stays: a house with a chimney.
  - Events: a ticket with a perforation.
  - Community: a speech bubble.
  - Services: *proposal*, a key tag (a rounded tag with a ring hole). It reads as "we take care of it", and it is distinct from the house and the ticket.
- **Closed states:** idle, listening, thinking, working, responding, suggesting, switching, resting and human. Motion uses transform and opacity only, settles within 5 seconds, and has a still form under reduced motion (ADR 0107 decision 9).
- **Not a mascot, and not the logo.** The master logo is still to be designed (decision 5). It must stand apart from every mode silhouette, so that it never reads as one mode.

## Art direction for each mode

| | Stays | Events | Community | Services |
| --- | --- | --- | --- | --- |
| Create | Settled, confident | Anticipation without pressure | Welcome, safe to join | Relief: it's handled |
| Remove | Worry about money | Fear of missing out | Awkwardness, doubt about who runs it | Distrust of a stranger at the door |
| Imagery now | Illustration: window, sofa, lamp | Illustration: stage arch, lights | Illustration: chairs around a table | Illustration: door, keys, tag |
| Imagery later | Real daylight interiors of published Units | Venue or past-event photos with rights | Group activity shot with consent | The real provider and what they deliver, with consent |
| Exact facts | All-In Stay Total, deposit, WAT deadline | Date, time, venue, price, tickets left (if real) | Meeting time and place, who it's for | What's included, price, arrival window, who comes |

Events is next, so its ADR and CONTEXT.md will turn the Events column from hypothesis into rules. Until then, nothing here promises ticket holds, payment windows, membership rules or service guarantees.

## Services and Stays

Today the services (airport pickup, daily housekeeping, private chef, late-checkout greeting) are an optional catalogue inside a Stays quote, paid on platform. As a mode, Services gets its own accent, mark and lane.

- A service added to a stay quote stays inside Stays.
- Booking a service directly, on its own, happens in Services.
- The Services ADR decides where that boundary sits.

## Switching modes

- The server decides the mode; the client never sets it (ADR 0107 decision 2).
- When work is at risk, the concierge suggests the switch in fixed copy and the guest confirms it (tier C). An automatic switch is disclosed and can be undone.
- Each mode keeps its own lane. A switch leaves a divider row and carries no text across.
- The design goal is that the guest never wonders "did I lose my booking?" The switch copy patterns are on the Language page.
