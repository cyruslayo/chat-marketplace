# Guest focused journey

Status: approved design direction; implementation in progress.

## Goal

Apply the approved guest UX lab to the Shortlet guest journey. On phones, one current task owns the screen and its primary action. “Ask Shortlet” opens conversation without losing a draft, task position, or focus. Desktop keeps the conversation and task split. Standard routes retain the same authoritative facts and actions.

## Design and evidence

- Approved lab: `C:\AI2026\chat-marketplace\.scratch\guest-ux-lab\index.html`.
- Browser audit: `C:\AI2026\chat-marketplace\docs\design\guest-browser-audit-2026-11-03.md`.
- Strategy: `C:\AI2026\chat-marketplace\docs\design\shortlet-guest-ux-strategy-2026-11-02.md`.
- Mobile direction: `C:\AI2026\chat-marketplace\docs\design\shortlet-mobile-interface-direction-2026-11-02.md`.
- Guest kit: `docs/design/shortlet-design-system-direction.md` and `apps/web/src/shortlet-foundations.css`.

The lab is a presentation reference. Its fixtures, prices, dates, and payment simulation are not production rules. The user's approval settles the design direction; browser, accessibility, and domain verification remain required.

## Constraints

Use canonical application projections for price, deadline, status, consent, and actions. Retain conventional routes for critical workflows. Respect ADR 0005, 0015, 0016, 0041, 0044, 0049, 0074, 0075, 0077, 0078, 0080, and 0106 where relevant. Read intersecting ADRs, not only this list, for each issue. Preserve unrelated work. Never push, deploy, or merge without the owner's separate instruction.

## Acceptance

The five issues in `map.md` pass their named tests, focused captures, review, and the repository Definition of Done. The final batch passes `npm run check`, `npm run test:workers`, and `npm test` on its gated commit. Real phone, screen-reader, provider, or network checks that cannot run must be reported as evidence limits.
