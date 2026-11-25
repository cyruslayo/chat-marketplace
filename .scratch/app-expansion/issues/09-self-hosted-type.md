# Self-hosted type, measured on a slow phone

Status: ready-for-agent
Type: task
Blocked by: 07

## What to build

- Newsreader 500 and 400 italic, and Hanken Grotesk 400, 600 and 700 (five files, the kit's limit), subset to the characters the product uses, including ₦, as WOFF2 from our own origin. Keep the OFL notices.
- `font-display: swap`, system fallbacks, and size-adjusted fallbacks so text does not jump.
- Money stays in Newsreader (Hanken Grotesk has no ₦).
- Serve with long caching; add the files to the Worker asset guard and the landing assets.

## Acceptance criteria

- AC1: No third-party font request on any page.
- AC2: Text is readable before fonts load. The measured layout shift is reported; if the project has no limit, ask the owner for one.
- AC3: First render on the reference setup (low-end Android profile, slow network) is recorded before and after on five screens. The owner accepts the difference before merge.
- AC4: Every ₦ amount renders in Newsreader. With fonts blocked it renders in the fallback and nothing overlaps.
- AC5: The Worker bundle guard and the asset specs pass.

## ADR compliance

0078, 0095.

## Comments
